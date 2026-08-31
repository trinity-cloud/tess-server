import {type ChildProcess} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {homedir, totalmem} from 'node:os';
import {basename, join, resolve} from 'node:path';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text, useApp, useInput} from 'ink';
import {chooseModelPath} from '../browse.js';
import {fetchRuntimeCapabilities} from '../capabilities.js';
import {embeddedCatalog} from '../catalog.js';
import {
  launchOverridesFromResolved,
  resolveProfileConfiguration,
} from '../configuration.js';
import {candidateFromAnyPath, discoverModels} from '../discovery.js';
import {downloadCatalogEntry, type DownloadProgress} from '../download.js';
import {serveSpec, spawnCaptured, stopCaptured} from '../launch.js';
import {
  emptyLibrary,
  entryFromCandidate,
  loadModelLibrary,
  saveModelLibrary,
  upsertLibraryEntry,
} from '../library.js';
import {formatBytes, formatTokens} from '../profiles.js';
import {
  coarseProgressFromLog,
  parseProgressLine,
  progressLabel,
  progressLogLine,
  ProgressLineDecoder,
} from '../progress.js';
import {
  assertAuthKeyFile,
  assertPortAvailable,
  saveServerSettings,
  validateServerSettings,
} from '../server-settings.js';
import type {
  CatalogEntry,
  LaunchOverrides,
  LocalModelEntry,
  ModelCandidate,
  ModelLibrary,
  ProfileDescriptor,
  ResolvedProfileConfiguration,
  RuntimeCapabilities,
  RuntimeKind,
  ServerSettings,
  StartupProgress,
} from '../types.js';
import {Brand} from './Brand.js';

type View =
  | 'library'
  | 'manual-path'
  | 'details'
  | 'settings'
  | 'download-confirm'
  | 'downloading'
  | 'process';
type ProcessStatus = 'starting' | 'ready' | 'stopping' | 'exited' | 'failed';
type SettingsField = 'port' | 'alias' | 'auth' | 'key_file';

interface ModelRow {
  id: string;
  runtime: RuntimeKind;
  title: string;
  description: string;
  status: 'Ready' | 'Download' | 'Local' | 'Needs attention';
  candidate?: ModelCandidate;
  catalog?: CatalogEntry;
  library?: LocalModelEntry;
}

export interface AppProps {
  profiles: ProfileDescriptor[];
  payloadRoot: string;
  initialModelRoots: string[];
  initialServerSettings: ServerSettings;
  initialContext?: number;
  version: string;
}

const ansiPattern = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/gu;

function Key({children}: {children: React.ReactNode}): React.JSX.Element {
  return <Text color="cyan">{children}</Text>;
}

function runtimeName(runtime: RuntimeKind): string {
  return runtime === 'tess-mlx' ? 'Tess MLX' : 'GGUF';
}

function runtimeColor(runtime: RuntimeKind): 'magenta' | 'cyan' {
  return runtime === 'tess-mlx' ? 'magenta' : 'cyan';
}

function statusColor(status: ModelRow['status']): 'green' | 'yellow' | 'cyan' | 'red' {
  if (status === 'Ready') return 'green';
  if (status === 'Download') return 'yellow';
  if (status === 'Local') return 'cyan';
  return 'red';
}

function candidateRuntime(candidate: ModelCandidate): RuntimeKind {
  return candidate.profile.model.format === 'mlx' ? 'tess-mlx' : 'gguf';
}

function modelBytes(candidate: ModelCandidate): number {
  return [...candidate.profile.shards, ...(candidate.profile.draft ?? [])]
    .reduce((sum, artifact) => sum + artifact.bytes, 0);
}

function samePath(left: string, right: string): boolean {
  return resolve(left) === resolve(right);
}

function uniqueCandidates(candidates: ModelCandidate[]): ModelCandidate[] {
  const seen = new Set<string>();
  return candidates.filter(candidate => {
    const key = `${candidateRuntime(candidate)}\u0000${resolve(candidate.modelPath)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cycle<T>(values: readonly T[], current: T, direction: number): T {
  const position = Math.max(values.indexOf(current), 0);
  return values[(position + direction + values.length) % values.length] ?? current;
}

function progressPercent(progress: StartupProgress | DownloadProgress | undefined): number | undefined {
  if (!progress) return undefined;
  const total = 'totalBytes' in progress ? progress.totalBytes : progress.total;
  const completed = 'completedBytes' in progress ? progress.completedBytes : progress.completed;
  if (total === undefined || completed === undefined || total <= 0) return undefined;
  return Math.max(0, Math.min(100, Math.round(completed / total * 100)));
}

function bar(percent: number | undefined, width = 34): string {
  if (percent === undefined) return '━'.repeat(Math.max(8, Math.floor(width / 3)));
  const filled = Math.round(width * percent / 100);
  return `${'━'.repeat(filled)}${'─'.repeat(width - filled)}`;
}

function settingValue(settings: ServerSettings, field: SettingsField): string {
  if (field === 'port') return String(settings.port);
  if (field === 'alias') return settings.alias;
  if (field === 'auth') return settings.auth.mode === 'off' ? 'Off (loopback only)' : 'Bearer key file';
  return settings.auth.mode === 'file' ? settings.auth.key_file ?? '' : '';
}

function resolvedFor(profile: ProfileDescriptor | undefined, overrides: LaunchOverrides): ResolvedProfileConfiguration | undefined {
  if (!profile) return undefined;
  try {
    return resolveProfileConfiguration(profile, overrides);
  } catch {
    return undefined;
  }
}

function phaseTitle(progress: StartupProgress | undefined): string {
  if (!progress) return 'Starting';
  const titles: Record<StartupProgress['phase'], string> = {
    inspecting_model: 'Inspecting model',
    opening_weights: 'Opening weights',
    loading_weights: 'Loading weights',
    preparing_runtime: 'Preparing runtime',
    starting_api: 'Starting API',
    ready: 'Ready',
  };
  return titles[progress.phase];
}

export function App({
  profiles,
  payloadRoot,
  initialModelRoots,
  initialServerSettings,
  initialContext,
  version,
}: AppProps): React.JSX.Element {
  const {exit} = useApp();
  const [view, setView] = useState<View>('library');
  const [library, setLibrary] = useState<ModelLibrary>(() => structuredClone(emptyLibrary));
  const [candidates, setCandidates] = useState<ModelCandidate[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scanning, setScanning] = useState(true);
  const [message, setMessage] = useState('Loading your model library…');
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [manualPath, setManualPath] = useState('');
  const [modelOverrides, setModelOverrides] = useState<Record<string, LaunchOverrides>>({});
  const [serverSettings, setServerSettings] = useState(initialServerSettings);
  const [settingsIndex, setSettingsIndex] = useState(0);
  const [settingsInput, setSettingsInput] = useState<{field: SettingsField; value: string}>();
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>();
  const [downloadError, setDownloadError] = useState<string>();
  const [processStatus, setProcessStatus] = useState<ProcessStatus>('starting');
  const [processExit, setProcessExit] = useState<string>();
  const [startupProgress, setStartupProgress] = useState<StartupProgress>();
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [capabilities, setCapabilities] = useState<RuntimeCapabilities>();
  const [processNonce, setProcessNonce] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const childRef = useRef<ChildProcess | undefined>(undefined);
  const stopTimerRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const forceStopTimerRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const exitAfterStopRef = useRef(false);
  const downloadAbortRef = useRef<AbortController | undefined>(undefined);
  const progressSequenceRef = useRef(0);
  const processStartedAtRef = useRef(0);
  const activeRuntimeRef = useRef<RuntimeKind>('gguf');
  const authHeaderRef = useRef<Record<string, string>>({});
  const catalog = useMemo(() => embeddedCatalog(profiles), [profiles]);

  useEffect(() => {
    let active = true;
    const scan = async (): Promise<void> => {
      const supportedProfiles = new Set(catalog.map(entry => entry.profileId));
      setScanning(true);
      try {
        const saved = await loadModelLibrary();
        if (!active) return;
        setLibrary(saved);
        setMessage(saved.entries.length > 0 ? 'Checking saved model locations…' : 'Scanning configured model folders…');
        const savedCandidates = (await Promise.all(saved.entries.map(async entry => {
          try { return await candidateFromAnyPath(profiles, entry.path, entry.runtime); }
          catch { return undefined; }
        }))).filter((candidate): candidate is ModelCandidate => Boolean(candidate))
          .filter(candidate => supportedProfiles.has(candidate.profile.profile_id));
        if (active) setCandidates(uniqueCandidates(savedCandidates));
        const discovered = (await discoverModels(profiles, initialModelRoots))
          .filter(candidate => supportedProfiles.has(candidate.profile.profile_id));
        if (!active) return;
        setCandidates(uniqueCandidates([...savedCandidates, ...discovered]));
        setMessage(discovered.length + savedCandidates.length > 0
          ? 'Supported local models are ready. No network was contacted.'
          : 'Choose a model to download or add its existing local path.');
      } catch (error) {
        if (active) setMessage(`Library needs attention: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        if (active) setScanning(false);
      }
    };
    void scan();
    return () => { active = false; };
  }, [catalog, initialModelRoots.join('\u0000'), profiles, refreshNonce]);

  const rows = useMemo<ModelRow[]>(() => {
    return catalog.map(entry => {
      const saved = library.entries.find(item => item.catalogId === entry.id);
      const local = candidates.find(candidate =>
        (saved && samePath(candidate.modelPath, saved.path)) || candidate.profile.profile_id === entry.profileId);
      return {
        id: `catalog:${entry.id}`,
        runtime: entry.runtime,
        title: entry.displayName,
        description: entry.description,
        status: local?.complete ? 'Ready' : local ? 'Needs attention' : 'Download',
        catalog: entry,
        ...(local ? {candidate: local} : {}),
        ...(saved ? {library: saved} : {}),
      } satisfies ModelRow;
    });
  }, [candidates, catalog, library]);

  const boundedSelectedIndex = Math.min(selectedIndex, Math.max(rows.length - 1, 0));
  const selected = rows[boundedSelectedIndex];
  const selectedProfile = useMemo(() => selected?.candidate?.profile
    ?? profiles.find(profile => profile.profile_id === selected?.catalog?.profileId),
  [profiles, selected?.candidate?.profile, selected?.catalog?.profileId]);
  const overrides = selectedProfile ? modelOverrides[selectedProfile.profile_id] ?? {} : {};
  const resolved = useMemo(() => resolvedFor(selectedProfile, overrides), [selectedProfile, overrides]);
  const runtime = selected?.runtime ?? 'tess-mlx';
  const contextPresets = selectedProfile?.expert.context_presets ?? [];
  const settingsFields = useMemo<SettingsField[]>(
    () => ['port', 'alias', 'auth', ...(serverSettings.auth.mode === 'file' ? ['key_file' as const] : [])],
    [serverSettings.auth.mode],
  );

  useEffect(() => {
    if (!selectedProfile || initialContext === undefined) return;
    if (!selectedProfile.expert.context_presets.some(preset => preset.tokens === initialContext)) return;
    const key = selectedProfile.profile_id;
    setModelOverrides(current => current[key]?.context !== undefined
      ? current
      : {...current, [key]: {...(current[key] ?? {}), context: initialContext}});
  }, [initialContext, selectedProfile]);

  const updateOverride = useCallback((patch: LaunchOverrides) => {
    if (!selectedProfile) return;
    const key = selectedProfile.profile_id;
    setModelOverrides(current => ({...current, [key]: {...(current[key] ?? {}), ...patch}}));
  }, [selectedProfile]);

  const changeContext = useCallback((direction: number) => {
    if (!selectedProfile || !resolved || contextPresets.length === 0) return;
    updateOverride({context: cycle(contextPresets.map(preset => preset.tokens), resolved.context, direction)});
  }, [contextPresets, resolved, selectedProfile, updateOverride]);

  const addCandidate = useCallback(async (candidate: ModelCandidate, catalogEntry?: CatalogEntry) => {
    const supportedEntry = catalogEntry ?? catalog.find(entry => entry.profileId === candidate.profile.profile_id);
    if (!supportedEntry) {
      throw new Error('Tess Server currently supports only DeepSeek V4 Flash on Tess MLX and Tess-4 35B A3B on GGUF');
    }
    const entry = await entryFromCandidate(candidate, supportedEntry);
    const updated = upsertLibraryEntry(library, entry);
    await saveModelLibrary(updated);
    setLibrary(updated);
    setCandidates(current => uniqueCandidates([candidate, ...current]));
    setSelectedIndex(Math.max(0, catalog.findIndex(item => item.id === supportedEntry.id)));
    setMessage(candidate.complete
      ? `${candidate.profile.model.name} added. Model files were inspected without content hashing.`
      : `${candidate.profile.model.name} added, but it needs attention: ${candidate.issues.join('; ')}`);
    setView('library');
  }, [catalog, library]);

  const browse = useCallback(async () => {
    setMessage(`Opening the macOS ${runtime === 'tess-mlx' ? 'folder' : 'file'} chooser…`);
    try {
      const path = await chooseModelPath(runtime);
      if (!path) {
        setMessage('Browse cancelled. Press a to enter a path manually.');
        return;
      }
      const candidate = await candidateFromAnyPath(profiles, path, runtime);
      const catalogEntry = catalog.find(entry => entry.profileId === candidate.profile.profile_id);
      await addCandidate(candidate, catalogEntry);
    } catch (error) {
      setMessage(`Could not add model: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [addCandidate, catalog, profiles, runtime]);

  const appendOutput = useCallback((chunk: string, decoder: ProgressLineDecoder) => {
    const lines = decoder.push(chunk.replace(ansiPattern, ''));
    for (const line of lines) {
      const structured = parseProgressLine(line);
      if (structured) {
        setStartupProgress(current => !current || structured.sequence > current.sequence ? structured : current);
        progressSequenceRef.current = Math.max(progressSequenceRef.current, structured.sequence);
        setLogs(current => [...current, progressLogLine(structured)].slice(-200));
      } else if (activeRuntimeRef.current === 'gguf') {
        const coarse = coarseProgressFromLog(line, ++progressSequenceRef.current, processStartedAtRef.current);
        if (coarse) setStartupProgress(coarse);
      }
      if (!structured) setLogs(current => [...current, line].slice(-200));
    }
  }, []);

  const forceStopChild = useCallback(() => {
    const child = childRef.current;
    if (!child || child.exitCode !== null) {
      if (exitAfterStopRef.current) exit();
      return;
    }
    stopCaptured(child, 'SIGKILL');
  }, [exit]);

  const stopChild = useCallback(() => {
    const child = childRef.current;
    exitAfterStopRef.current = true;
    if (!child || child.exitCode !== null) {
      exit();
      return;
    }
    if (processStatus === 'stopping') {
      forceStopChild();
      return;
    }
    setProcessStatus('stopping');
    stopCaptured(child, 'SIGINT');
    stopTimerRef.current = setTimeout(() => {
      if (child.exitCode === null) stopCaptured(child, 'SIGTERM');
    }, 500);
    forceStopTimerRef.current = setTimeout(() => {
      if (child.exitCode === null) stopCaptured(child, 'SIGKILL');
    }, 1500);
  }, [exit, forceStopChild, processStatus]);

  useEffect(() => () => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    if (forceStopTimerRef.current) clearTimeout(forceStopTimerRef.current);
    const child = childRef.current;
    if (child && child.exitCode === null) stopCaptured(child, 'SIGTERM');
    downloadAbortRef.current?.abort();
  }, []);

  const launch = useCallback(async () => {
    if (!selected?.candidate || !selected.candidate.complete || !resolved?.startable) {
      setMessage('This model needs attention before it can launch. Open Details for the exact issue.');
      setView('details');
      return;
    }
    setProcessStatus('starting');
    setProcessExit(undefined);
    setStartupProgress(undefined);
    setCapabilities(undefined);
    setLogs([]);
    setShowLogs(true);
    exitAfterStopRef.current = false;
    setView('process');
    progressSequenceRef.current = 0;
    processStartedAtRef.current = Date.now();
    activeRuntimeRef.current = selected.runtime;
    try {
      await assertAuthKeyFile(serverSettings);
      await assertPortAvailable(serverSettings.port);
      authHeaderRef.current = {};
      if (serverSettings.auth.mode === 'file') {
        authHeaderRef.current = {Authorization: `Bearer ${(await readFile(serverSettings.auth.key_file!, 'utf8')).trim()}`};
      }
      const spec = serveSpec(payloadRoot, selected.candidate, {
        ...(selected.candidate.kind === 'profiled' ? launchOverridesFromResolved(resolved) : overrides),
        port: serverSettings.port,
        alias: serverSettings.alias,
        ...(serverSettings.auth.mode === 'file' ? {apiKeyFile: serverSettings.auth.key_file} : {}),
      });
      const child = spawnCaptured(spec);
      childRef.current = child;
      setProcessNonce(value => value + 1);
      const stdoutDecoder = new ProgressLineDecoder();
      const stderrDecoder = new ProgressLineDecoder();
      child.stdout?.on('data', chunk => appendOutput(String(chunk), stdoutDecoder));
      child.stderr?.on('data', chunk => appendOutput(String(chunk), stderrDecoder));
      child.once('error', error => {
        setLogs(current => [...current, error.message].slice(-200));
        setProcessStatus('failed');
        setProcessExit('process could not start');
      });
      child.once('exit', (code, signal) => {
        for (const line of [...stdoutDecoder.finish(), ...stderrDecoder.finish()]) {
          if (!line.includes('TESS_PROGRESS ')) setLogs(current => [...current, line].slice(-200));
        }
        if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
        if (forceStopTimerRef.current) clearTimeout(forceStopTimerRef.current);
        setProcessStatus(current => current === 'ready' && code === 0 ? 'exited' : code === 0 ? 'exited' : 'failed');
        setProcessExit(code === null ? `signal ${signal ?? 'unknown'}` : `exit ${code}`);
        if (exitAfterStopRef.current) exit();
      });
    } catch (error) {
      setLogs([error instanceof Error ? error.message : String(error)]);
      setProcessStatus('failed');
      setProcessExit('preflight failed');
    }
  }, [appendOutput, exit, overrides, payloadRoot, resolved, selected, serverSettings]);

  useEffect(() => {
    if (view !== 'process' || processStatus !== 'starting' || processNonce === 0) return;
    const controller = new AbortController();
    const base = `http://127.0.0.1:${serverSettings.port}`;
    const poll = setInterval(() => {
      void fetch(`${base}/health`, {headers: authHeaderRef.current, signal: controller.signal})
        .then(response => {
          if (!response.ok) return;
          setProcessStatus('ready');
          setStartupProgress({
            schemaVersion: 1,
            sequence: ++progressSequenceRef.current,
            phase: 'ready',
            elapsedMs: Date.now() - processStartedAtRef.current,
            message: 'Server ready',
            receivedAt: Date.now(),
          });
          clearInterval(poll);
          void fetchRuntimeCapabilities(base, (input, init) => fetch(input, {
            ...init,
            headers: {...Object.fromEntries(new Headers(init?.headers).entries()), ...authHeaderRef.current},
          })).then(setCapabilities).catch(() => undefined);
        })
        .catch(() => undefined);
    }, 500);
    return () => { clearInterval(poll); controller.abort(); };
  }, [processNonce, processStatus, serverSettings.port, view]);

  useEffect(() => {
    if (view !== 'process' || (processStatus !== 'starting' && processStatus !== 'stopping')) return;
    setClock(Date.now());
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [processStatus, view]);

  const beginDownload = useCallback(async () => {
    if (!selected?.catalog) return;
    const controller = new AbortController();
    downloadAbortRef.current = controller;
    setDownloadError(undefined);
    setDownloadProgress({phase: 'preparing', completedBytes: 0, totalBytes: selected.catalog.diskBytes});
    setView('downloading');
    const root = process.env.TESS_SERVER_MODEL_DOWNLOAD_ROOT ?? join(
      homedir(), 'Library', 'Application Support', 'Trinity Cloud', 'Tess Server', 'Models',
    );
    try {
      const directory = await downloadCatalogEntry(selected.catalog, {
        destinationRoot: root,
        signal: controller.signal,
        onProgress: setDownloadProgress,
      });
      const profile = profiles.find(item => item.profile_id === selected.catalog!.profileId);
      if (!profile) throw new Error('downloaded model profile is unavailable');
      const path = selected.runtime === 'tess-mlx' ? directory : join(directory, profile.shards[0]!.name);
      const candidate = await candidateFromAnyPath(profiles, path, selected.runtime);
      await addCandidate(candidate, selected.catalog);
    } catch (error) {
      setDownloadError(error instanceof Error && error.name === 'AbortError'
        ? 'Download paused. The partial files are retained for a safe resume.'
        : error instanceof Error ? error.message : String(error));
    }
  }, [addCandidate, profiles, selected]);

  const saveSettingInput = useCallback(async () => {
    if (!settingsInput) return;
    try {
      const next: ServerSettings = settingsInput.field === 'port'
        ? {...serverSettings, port: Number(settingsInput.value)}
        : settingsInput.field === 'alias'
          ? {...serverSettings, alias: settingsInput.value}
          : {...serverSettings, auth: {mode: 'file', key_file: settingsInput.value}};
      const validated = validateServerSettings(next);
      await saveServerSettings(validated);
      setServerSettings(validated);
      setSettingsInput(undefined);
      setMessage('Server settings saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [serverSettings, settingsInput]);

  useInput((input, key) => {
    if (view === 'manual-path') {
      if (key.escape) { setView('library'); setManualPath(''); return; }
      if (key.return) {
        const path = manualPath.trim();
        if (!path) return;
        void candidateFromAnyPath(profiles, path, runtime)
          .then(candidate => addCandidate(candidate, catalog.find(entry => entry.profileId === candidate.profile.profile_id)))
          .catch(error => setMessage(`Could not add model: ${error instanceof Error ? error.message : String(error)}`));
        return;
      }
      if (key.backspace || key.delete) setManualPath(value => value.slice(0, -1));
      else if (!key.ctrl && !key.meta && input) setManualPath(value => value + input);
      return;
    }
    if (settingsInput) {
      if (key.escape) { setSettingsInput(undefined); return; }
      if (key.return) { void saveSettingInput(); return; }
      if (key.backspace || key.delete) setSettingsInput(current => current ? {...current, value: current.value.slice(0, -1)} : current);
      else if (!key.ctrl && !key.meta && input) setSettingsInput(current => current ? {...current, value: current.value + input} : current);
      return;
    }
    if (view === 'process') {
      if (input === 'l') { setShowLogs(value => !value); return; }
      if (input === 'q' || key.escape) {
        if (processStatus === 'starting' || processStatus === 'ready' || processStatus === 'stopping') stopChild();
        else setView('library');
      }
      return;
    }
    if (view === 'downloading') {
      if (input === 'q' || input === 'c' || key.escape) {
        if (!downloadError && downloadProgress?.phase !== 'complete') downloadAbortRef.current?.abort();
        else setView('library');
      }
      return;
    }
    if (view === 'download-confirm') {
      if (key.return) void beginDownload();
      else if (key.escape || input === 'q') setView('library');
      return;
    }
    if (view === 'settings') {
      if (key.escape || input === 'q') { setView('library'); return; }
      if (key.upArrow) setSettingsIndex(value => Math.max(0, value - 1));
      else if (key.downArrow) setSettingsIndex(value => Math.min(settingsFields.length - 1, value + 1));
      else if (key.return || input === 'e') {
        const field = settingsFields[settingsIndex];
        if (!field) return;
        if (field === 'auth') {
          const next: ServerSettings = serverSettings.auth.mode === 'off'
            ? {...serverSettings, auth: {mode: 'file', key_file: join(homedir(), '.config', 'tess-server', 'api-key')}}
            : {...serverSettings, auth: {mode: 'off'}};
          try {
            const validated = validateServerSettings(next);
            setServerSettings(validated);
            void saveServerSettings(validated);
          } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
        } else {
          setSettingsInput({field, value: settingValue(serverSettings, field)});
        }
      }
      return;
    }
    if (view === 'details') {
      if (key.escape || input === 'q') { setView('library'); return; }
      if (input === 'd' && selected?.catalog && !selected.candidate) { setView('download-confirm'); return; }
      if (key.return && selected?.candidate) void launch();
      return;
    }
    if (view !== 'library') return;
    if (input === 'q') { exit(); return; }
    if (key.upArrow) setSelectedIndex(value => Math.max(0, value - 1));
    else if (key.downArrow) setSelectedIndex(value => Math.min(rows.length - 1, value + 1));
    else if (key.tab) setSelectedIndex(value => rows.length === 0 ? 0 : (value + 1) % rows.length);
    else if (key.leftArrow) changeContext(-1);
    else if (key.rightArrow || input === 'c') changeContext(1);
    else if (key.return) selected?.candidate ? void launch() : selected?.catalog?.downloadEnabled ? setView('download-confirm') : setView('details');
    else if (input === 'i') setView('details');
    else if (input === 'd' && selected?.catalog && !selected.candidate) setView('download-confirm');
    else if (input === 'b') void browse();
    else if (input === 'a') { setManualPath(''); setView('manual-path'); }
    else if (input === ',') { setSettingsIndex(0); setView('settings'); }
    else if (input === 'r') setRefreshNonce(value => value + 1);
  });

  if (view === 'manual-path') {
    return <Box flexDirection="column">
      <Brand version={version}/>
      <Text bold>Add a {runtimeName(runtime)} model</Text>
      <Text dimColor>{runtime === 'tess-mlx' ? 'Enter the model directory.' : 'Enter a GGUF file, using the first shard for sharded models.'}</Text>
      <Box borderStyle="round" borderColor="cyan" paddingX={1} marginTop={1}>
        <Text>{manualPath || ' '}</Text><Text color="cyan">█</Text>
      </Box>
      <Text><Key>enter</Key> Add  <Key>esc</Key> Cancel</Text>
      <Text dimColor>{message}</Text>
    </Box>;
  }

  if (view === 'settings') {
    return <Box flexDirection="column">
      <Brand version={version}/>
      <Text bold>Server settings</Text>
      <Text dimColor>These settings apply to both Tess MLX and GGUF.</Text>
      <Box flexDirection="column" borderStyle="round" paddingX={1} marginTop={1}>
        {settingsFields.map((field, index) => <Text key={field} {...(index === settingsIndex ? {color: 'cyan' as const} : {})}>
          {index === settingsIndex ? '› ' : '  '}{field === 'key_file' ? 'API key file' : field === 'alias' ? 'API model name' : field[0]!.toUpperCase() + field.slice(1)}: {settingValue(serverSettings, field)}
        </Text>)}
      </Box>
      {settingsInput ? <Text><Key>Editing</Key> {settingsInput.value}█</Text> : <Text><Key>↑↓</Key> Select  <Key>enter</Key> Edit / toggle  <Key>esc</Key> Back</Text>}
      <Text dimColor>Endpoint http://127.0.0.1:{serverSettings.port}/v1 · {message}</Text>
    </Box>;
  }

  if (view === 'details') {
    return <Box flexDirection="column">
      <Brand version={version}/>
      <Box justifyContent="space-between">
        <Text bold>{selected?.title ?? 'Model details'}</Text>
        {selected && <Text color={runtimeColor(selected.runtime)}>{runtimeName(selected.runtime)}</Text>}
      </Box>
      {selected && <Box flexDirection="column" borderStyle="round" paddingX={1} marginTop={1}>
        <Text color={statusColor(selected.status)} bold>{selected.status}</Text>
        <Text>{selected.description}</Text>
        {selected.candidate && <Text>Model size: {formatBytes(modelBytes(selected.candidate))}</Text>}
        {selected.candidate && <Text>Context: {formatTokens(resolved?.context ?? selected.candidate.profile.context.default)}</Text>}
        {selected.catalog && <Text>Source: {selected.catalog.repository} @ {selected.catalog.revision}</Text>}
        {selected.catalog && <Text>License: {selected.catalog.licenseName} · {selected.catalog.licenseUrl}</Text>}
        {selected.catalog && <Text>Capabilities: {selected.catalog.capabilities.join(' · ')}</Text>}
        {selected.candidate?.issues.map(issue => <Text key={issue} color="red">Needs attention: {issue}</Text>)}
        {resolved?.rejection && <Text color="red">Needs attention: {resolved.rejection}</Text>}
      </Box>}
      <Text>
        {selected?.candidate ? <><Key>enter</Key> Launch  </> : selected?.catalog?.downloadEnabled ? <><Key>d</Key> Download  </> : null}
        <Key>esc</Key> Back
      </Text>
      {selected?.catalog?.downloadUnavailableReason && <Text color="yellow">{selected.catalog.downloadUnavailableReason}</Text>}
    </Box>;
  }

  if (view === 'download-confirm') {
    return <Box flexDirection="column">
      <Brand version={version}/>
      <Text bold>Download {selected?.title}</Text>
      {selected?.catalog && <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginTop={1}>
        <Text>Repository: {selected.catalog.repository}</Text>
        <Text>Revision: {selected.catalog.revision}</Text>
        <Text>Download: {formatBytes(selected.catalog.diskBytes)}</Text>
        <Text>License: {selected.catalog.licenseName}</Text>
        <Text>Destination: Tess Server Models/{selected.catalog.destinationSlug}</Text>
        <Text dimColor>Network access starts only after you confirm. Transfers resume safely and finish atomically.</Text>
      </Box>}
      <Text><Key>enter</Key> Confirm download  <Key>esc</Key> Cancel</Text>
    </Box>;
  }

  if (view === 'downloading') {
    const percent = progressPercent(downloadProgress);
    return <Box flexDirection="column">
      <Brand version={version}/>
      <Text bold>Downloading {selected?.title}</Text>
      <Box borderStyle="round" borderColor={downloadError ? 'red' : 'cyan'} flexDirection="column" paddingX={1} marginTop={1}>
        <Text color={downloadError ? 'red' : 'cyan'}>{downloadError ?? downloadProgress?.phase ?? 'Preparing'}</Text>
        <Text color="cyan">{bar(percent)} {percent === undefined ? '' : `${percent}%`}</Text>
        {downloadProgress?.file && <Text>{downloadProgress.file} · {formatBytes(downloadProgress.fileCompletedBytes ?? 0)} / {formatBytes(downloadProgress.fileTotalBytes ?? 0)}</Text>}
        {downloadProgress && <Text>{formatBytes(downloadProgress.completedBytes)} / {formatBytes(downloadProgress.totalBytes)}</Text>}
      </Box>
      <Text><Key>{downloadError ? 'q' : 'c'}</Key> {downloadError ? 'Back' : 'Pause and keep partial download'}</Text>
    </Box>;
  }

  if (view === 'process') {
    const percent = progressPercent(startupProgress);
    return <Box flexDirection="column">
      <Brand version={version}/>
      <Box justifyContent="space-between">
        <Text bold>{selected?.title}</Text>
        <Text color={processStatus === 'ready' ? 'green' : processStatus === 'failed' ? 'red' : 'yellow'}>{processStatus.toUpperCase()}</Text>
      </Box>
      <Box borderStyle="round" borderColor={processStatus === 'ready' ? 'green' : processStatus === 'failed' ? 'red' : runtimeColor(selected?.runtime ?? runtime)} flexDirection="column" paddingX={1} marginTop={1}>
        <Text bold>{phaseTitle(startupProgress)}</Text>
        <Text color="cyan">{bar(percent)} {percent === undefined ? '' : `${percent}%`}</Text>
        <Text>{progressLabel(startupProgress, clock)}</Text>
        <Text dimColor>Elapsed {Math.floor((startupProgress?.elapsedMs ?? clock - processStartedAtRef.current) / 1000)}s · model footprint {selected?.candidate ? formatBytes(modelBytes(selected.candidate)) : 'unknown'}</Text>
        {resolved && <Text>Selected context {formatTokens(resolved.context)}</Text>}
        {capabilities && <Text>Context {formatTokens(capabilities.contextWindow)} · output budget {formatTokens(capabilities.maxOutputTokens)} · {capabilities.slots} slot{capabilities.slots === 1 ? '' : 's'}</Text>}
        {processExit && <Text {...(processStatus === 'failed' ? {color: 'red' as const} : {})}>{processExit}</Text>}
      </Box>
      {showLogs && <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Text bold dimColor>Logs</Text>
        {logs.slice(-12).map((line, index) => <Text key={`${index}:${line}`} wrap="truncate">{line}</Text>)}
      </Box>}
      <Text><Key>l</Key> {showLogs ? 'Hide logs' : 'Show logs'}  <Key>q</Key> {processStatus === 'stopping' ? 'Force stop' : processStatus === 'starting' || processStatus === 'ready' ? 'Stop and quit' : 'Back'}</Text>
    </Box>;
  }

  return <Box flexDirection="column">
    <Brand version={version}/>
    <Box justifyContent="space-between">
      <Text bold>Choose a model and context</Text>
      <Text dimColor>Server stopped · {Math.round(totalmem() / 1024 ** 3)} GiB Mac</Text>
    </Box>
    <Box flexDirection="column" borderStyle="round" borderColor={runtimeColor(runtime)} paddingX={1} marginTop={1}>
      <Text bold>Model</Text>
      {rows.map((row, index) => {
        const active = index === boundedSelectedIndex;
        return <Box key={row.id}>
          <Text {...(active ? {color: runtimeColor(row.runtime)} : {})} bold={active}>{active ? '› ' : '  '}</Text>
          <Box width={34}><Text bold={active} wrap="truncate">{row.title}</Text></Box>
          <Box width={12}><Text color={runtimeColor(row.runtime)}>{runtimeName(row.runtime)}</Text></Box>
          <Box width={13}><Text>{row.candidate ? formatBytes(modelBytes(row.candidate)) : row.catalog ? formatBytes(row.catalog.diskBytes) : '—'}</Text></Box>
          <Text color={statusColor(row.status)}>{row.status}</Text>
        </Box>;
      })}
      <Text> </Text>
      <Text bold>Context length</Text>
      <Box>
        {contextPresets.map(preset => {
          const active = preset.tokens === resolved?.context;
          return <React.Fragment key={preset.tokens}>
            <Text {...(active ? {color: runtimeColor(runtime), bold: true} : {})}>[{active ? '› ' : '  '}{preset.label}]</Text>
            <Text> </Text>
          </React.Fragment>;
        })}
      </Box>
      <Text dimColor>{selected?.description}</Text>
      {resolved && resolved.context > (selectedProfile?.context.default ?? resolved.context)
        && <Text dimColor>Larger contexts use more memory.</Text>}
      {selected?.candidate?.issues.map(issue => <Text key={issue} color="red">Needs attention: {issue}</Text>)}
    </Box>
    <Text dimColor>{scanning ? 'Scanning for the two supported models… ' : ''}{message}</Text>
    <Text>
      <Key>↑↓</Key> Model  <Key>←→</Key> Context  <Key>enter</Key> {selected?.candidate ? 'Launch' : 'Download'}
    </Text>
    <Text>
      <Key>b</Key> Locate model  <Key>,</Key> Settings  <Key>r</Key> Rescan  <Key>q</Key> Quit
    </Text>
    <Text dimColor>No network access unless you confirm a download.</Text>
  </Box>;
}
