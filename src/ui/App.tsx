import {type ChildProcess} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {homedir, totalmem} from 'node:os';
import {basename, join, resolve} from 'node:path';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text, useApp, useInput} from 'ink';
import {chooseModelPath} from '../browse.js';
import {fetchRuntimeCapabilities} from '../capabilities.js';
import {catalogForHost, embeddedCatalog, hostMemoryGiB} from '../catalog.js';
import {
  genericBatchChoices,
  genericContextChoices,
  genericFlashAttentionChoices,
  genericSlotChoices,
  genericUbatchChoices,
  launchOverridesFromResolved,
  resolveProfileConfiguration,
  resolveUnprofiledConfiguration,
} from '../configuration.js';
import {candidateFromAnyPath, discoverModels} from '../discovery.js';
import {downloadCatalogEntry, type DownloadProgress} from '../download.js';
import {serveSpec, spawnCaptured, stopCaptured} from '../launch.js';
import {
  emptyLibrary,
  entryFromCandidate,
  loadModelLibrary,
  removeLibraryEntry,
  saveModelLibrary,
  upsertLibraryEntry,
} from '../library.js';
import {formatBytes, formatTokens} from '../profiles.js';
import {coarseProgressFromLog, parseProgressLine, progressLabel, ProgressLineDecoder} from '../progress.js';
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
  | 'advanced'
  | 'settings'
  | 'download-confirm'
  | 'downloading'
  | 'process';
type ProcessStatus = 'starting' | 'ready' | 'stopping' | 'exited' | 'failed';
type SettingsField = 'port' | 'alias' | 'auth' | 'key_file';
type AdvancedField = 'context' | 'batch' | 'ubatch' | 'slots' | 'flash_attention';

interface ModelRow {
  id: string;
  section: 'Recommended' | 'My Models';
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

function resolvedFor(candidate: ModelCandidate | undefined, overrides: LaunchOverrides): ResolvedProfileConfiguration | undefined {
  if (!candidate) return undefined;
  try {
    return candidate.kind === 'profiled'
      ? resolveProfileConfiguration(candidate.profile, overrides)
      : resolveUnprofiledConfiguration(candidate, overrides);
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
  const [runtime, setRuntime] = useState<RuntimeKind>('tess-mlx');
  const [library, setLibrary] = useState<ModelLibrary>(() => structuredClone(emptyLibrary));
  const [candidates, setCandidates] = useState<ModelCandidate[]>([]);
  const [selectedByRuntime, setSelectedByRuntime] = useState<Record<RuntimeKind, number>>({'tess-mlx': 0, gguf: 0});
  const [showOtherMacs, setShowOtherMacs] = useState(false);
  const [scanning, setScanning] = useState(true);
  const [message, setMessage] = useState('Loading your model library…');
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [manualPath, setManualPath] = useState('');
  const [modelOverrides, setModelOverrides] = useState<Record<string, LaunchOverrides>>({});
  const [advancedIndex, setAdvancedIndex] = useState(0);
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
  const downloadAbortRef = useRef<AbortController | undefined>(undefined);
  const progressSequenceRef = useRef(0);
  const processStartedAtRef = useRef(0);
  const activeRuntimeRef = useRef<RuntimeKind>('gguf');
  const authHeaderRef = useRef<Record<string, string>>({});
  const catalog = useMemo(() => embeddedCatalog(profiles), [profiles]);
  const visibleCatalog = useMemo(
    () => showOtherMacs ? catalog : catalogForHost(catalog),
    [catalog, showOtherMacs],
  );

  useEffect(() => {
    let active = true;
    const scan = async (): Promise<void> => {
      setScanning(true);
      try {
        const saved = await loadModelLibrary();
        if (!active) return;
        setLibrary(saved);
        setMessage(saved.entries.length > 0 ? 'Checking saved model locations…' : 'Scanning configured model folders…');
        const savedCandidates = (await Promise.all(saved.entries.map(async entry => {
          try { return await candidateFromAnyPath(profiles, entry.path, entry.runtime); }
          catch { return undefined; }
        }))).filter((candidate): candidate is ModelCandidate => Boolean(candidate));
        if (active) setCandidates(uniqueCandidates(savedCandidates));
        const discovered = await discoverModels(profiles, initialModelRoots);
        if (!active) return;
        setCandidates(uniqueCandidates([...savedCandidates, ...discovered]));
        setMessage(discovered.length + savedCandidates.length > 0
          ? 'Local models are ready. No network was contacted.'
          : 'No local model found yet. Browse, add a path, or choose a download.');
      } catch (error) {
        if (active) setMessage(`Library needs attention: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        if (active) setScanning(false);
      }
    };
    void scan();
    return () => { active = false; };
  }, [initialModelRoots.join('\u0000'), profiles, refreshNonce]);

  const rows = useMemo<ModelRow[]>(() => {
    const output: ModelRow[] = [];
    const usedPaths = new Set<string>();
    for (const entry of visibleCatalog.filter(item => item.runtime === runtime)) {
      const saved = library.entries.find(item => item.catalogId === entry.id);
      const local = candidates.find(candidate =>
        (saved && samePath(candidate.modelPath, saved.path)) || candidate.profile.profile_id === entry.profileId);
      if (local) usedPaths.add(resolve(local.modelPath));
      output.push({
        id: `catalog:${entry.id}`,
        section: 'Recommended',
        runtime,
        title: entry.displayName,
        description: entry.description,
        status: local?.complete ? 'Ready' : local ? 'Needs attention' : 'Download',
        catalog: entry,
        ...(local ? {candidate: local} : {}),
        ...(saved ? {library: saved} : {}),
      });
    }
    for (const saved of library.entries.filter(item => item.runtime === runtime && !item.catalogId)) {
      const local = candidates.find(candidate => samePath(candidate.modelPath, saved.path));
      if (local) usedPaths.add(resolve(local.modelPath));
      output.push({
        id: `library:${saved.id}`,
        section: 'My Models',
        runtime,
        title: saved.displayName,
        description: saved.path,
        status: local?.complete ? 'Local' : 'Needs attention',
        library: saved,
        ...(local ? {candidate: local} : {}),
      });
    }
    for (const candidate of candidates.filter(item => candidateRuntime(item) === runtime && !usedPaths.has(resolve(item.modelPath)))) {
      const matchingCatalog = visibleCatalog.find(entry => entry.profileId === candidate.profile.profile_id);
      if (matchingCatalog) continue;
      output.push({
        id: `candidate:${candidate.profile.profile_id}:${candidate.modelPath}`,
        section: 'My Models',
        runtime,
        title: candidate.profile.model.name,
        description: candidate.modelPath,
        status: candidate.complete ? 'Local' : 'Needs attention',
        candidate,
      });
    }
    return output;
  }, [candidates, library, runtime, visibleCatalog]);

  const selectedIndex = Math.min(selectedByRuntime[runtime], Math.max(rows.length - 1, 0));
  const selected = rows[selectedIndex];
  const overrides = selected?.candidate ? modelOverrides[selected.candidate.profile.profile_id] ?? {} : {};
  const resolved = useMemo(() => resolvedFor(selected?.candidate, overrides), [selected?.candidate, overrides]);
  const settingsFields = useMemo<SettingsField[]>(
    () => ['port', 'alias', 'auth', ...(serverSettings.auth.mode === 'file' ? ['key_file' as const] : [])],
    [serverSettings.auth.mode],
  );
  const advancedFields = useMemo<AdvancedField[]>(
    () => selected?.candidate?.kind === 'unprofiled'
      ? ['context', 'batch', 'ubatch', 'slots', 'flash_attention']
      : ['context'],
    [selected?.candidate?.kind],
  );

  useEffect(() => {
    if (!selected?.candidate || initialContext === undefined) return;
    const key = selected.candidate.profile.profile_id;
    setModelOverrides(current => current[key]?.context !== undefined
      ? current
      : {...current, [key]: {...(current[key] ?? {}), context: initialContext}});
  }, [initialContext, selected?.candidate]);

  const updateOverride = useCallback((patch: LaunchOverrides) => {
    if (!selected?.candidate) return;
    const key = selected.candidate.profile.profile_id;
    setModelOverrides(current => ({...current, [key]: {...(current[key] ?? {}), ...patch}}));
  }, [selected?.candidate]);

  const addCandidate = useCallback(async (candidate: ModelCandidate, catalogEntry?: CatalogEntry) => {
    const entry = await entryFromCandidate(candidate, catalogEntry);
    const updated = upsertLibraryEntry(library, entry);
    await saveModelLibrary(updated);
    setLibrary(updated);
    setCandidates(current => uniqueCandidates([candidate, ...current]));
    setRuntime(candidateRuntime(candidate));
    setSelectedByRuntime(current => ({...current, [candidateRuntime(candidate)]: 0}));
    setMessage(candidate.complete
      ? `${candidate.profile.model.name} added. Model files were inspected without content hashing.`
      : `${candidate.profile.model.name} added, but it needs attention: ${candidate.issues.join('; ')}`);
    setView('library');
  }, [library]);

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
      } else if (activeRuntimeRef.current === 'gguf') {
        const coarse = coarseProgressFromLog(line, ++progressSequenceRef.current, processStartedAtRef.current);
        if (coarse) setStartupProgress(coarse);
      }
      if (!line.includes('TESS_PROGRESS ')) setLogs(current => [...current, line].slice(-200));
    }
  }, []);

  const stopChild = useCallback(() => {
    const child = childRef.current;
    if (!child || child.exitCode !== null || child.killed) return;
    setProcessStatus('stopping');
    stopCaptured(child, 'SIGINT');
    stopTimerRef.current = setTimeout(() => {
      if (child.exitCode === null) stopCaptured(child, 'SIGTERM');
    }, 5000);
  }, []);

  useEffect(() => () => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
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
    setShowLogs(false);
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
        setProcessStatus(current => current === 'ready' && code === 0 ? 'exited' : code === 0 ? 'exited' : 'failed');
        setProcessExit(code === null ? `signal ${signal ?? 'unknown'}` : `exit ${code}`);
      });
    } catch (error) {
      setLogs([error instanceof Error ? error.message : String(error)]);
      setProcessStatus('failed');
      setProcessExit('preflight failed');
    }
  }, [appendOutput, overrides, payloadRoot, resolved, selected, serverSettings]);

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

  const changeAdvanced = useCallback((direction: number) => {
    if (!selected?.candidate || !resolved) return;
    const field = advancedFields[advancedIndex];
    if (field === 'context') {
      const values = selected.candidate.kind === 'profiled'
        ? selected.candidate.profile.expert.context_presets
          .filter(preset => preset.availability !== 'qualification-pending').map(preset => preset.tokens)
        : [...genericContextChoices];
      updateOverride({context: cycle(values, resolved.context, direction)});
    } else if (field === 'batch') {
      updateOverride({batch: cycle(genericBatchChoices, resolved.batch, direction)});
    } else if (field === 'ubatch') {
      updateOverride({ubatch: cycle(genericUbatchChoices, resolved.ubatch, direction)});
    } else if (field === 'slots') {
      updateOverride({slots: cycle(genericSlotChoices, resolved.slots ?? 1, direction)});
    } else if (field === 'flash_attention') {
      updateOverride({flashAttention: cycle(genericFlashAttentionChoices, resolved.flashAttention ?? 'auto', direction)});
    }
  }, [advancedFields, advancedIndex, resolved, selected?.candidate, updateOverride]);

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
    if (view === 'advanced') {
      if (key.escape || input === 'q') { setView('details'); return; }
      if (key.upArrow) setAdvancedIndex(value => Math.max(0, value - 1));
      else if (key.downArrow) setAdvancedIndex(value => Math.min(advancedFields.length - 1, value + 1));
      else if (key.leftArrow) changeAdvanced(-1);
      else if (key.rightArrow || key.return) changeAdvanced(1);
      return;
    }
    if (view === 'details') {
      if (key.escape || input === 'q') { setView('library'); return; }
      if (input === 'x') { setAdvancedIndex(0); setView('advanced'); return; }
      if (input === 'd' && selected?.catalog && !selected.candidate) { setView('download-confirm'); return; }
      if (input === 'r' && selected?.library) {
        const updated = removeLibraryEntry(library, selected.library.id);
        void saveModelLibrary(updated).then(() => {
          setLibrary(updated);
          setMessage('Removed from My Models. No model files were deleted.');
          setView('library');
        });
        return;
      }
      if (key.return && selected?.candidate) void launch();
      return;
    }
    if (view !== 'library') return;
    if (input === 'q') { exit(); return; }
    if (key.tab || key.leftArrow || key.rightArrow) {
      setRuntime(value => value === 'tess-mlx' ? 'gguf' : 'tess-mlx');
      return;
    }
    if (key.upArrow) setSelectedByRuntime(current => ({...current, [runtime]: Math.max(0, selectedIndex - 1)}));
    else if (key.downArrow) setSelectedByRuntime(current => ({...current, [runtime]: Math.min(rows.length - 1, selectedIndex + 1)}));
    else if (key.return) selected?.candidate ? void launch() : setView('details');
    else if (input === 'i') setView('details');
    else if (input === 'd' && selected?.catalog && !selected.candidate) setView('download-confirm');
    else if (input === 'b') void browse();
    else if (input === 'a') { setManualPath(''); setView('manual-path'); }
    else if (input === ',') { setSettingsIndex(0); setView('settings'); }
    else if (input === 'o') setShowOtherMacs(value => !value);
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

  if (view === 'advanced') {
    return <Box flexDirection="column">
      <Brand version={version}/>
      <Text bold>Advanced · {selected?.title}</Text>
      <Text dimColor>Recommended defaults are already selected. Change these only when you know the model's limits.</Text>
      <Box flexDirection="column" borderStyle="round" paddingX={1} marginTop={1}>
        {advancedFields.map((field, index) => {
          const value = field === 'context' ? resolved?.context
            : field === 'batch' ? resolved?.batch
              : field === 'ubatch' ? resolved?.ubatch
                : field === 'slots' ? resolved?.slots
                  : resolved?.flashAttention;
          return <Text key={field} {...(index === advancedIndex ? {color: 'cyan' as const} : {})}>
            {index === advancedIndex ? '› ' : '  '}{field.replace('_', ' ')}: {field === 'context' && typeof value === 'number' ? formatTokens(value) : String(value ?? 'default')}
          </Text>;
        })}
      </Box>
      <Text><Key>↑↓</Key> Select  <Key>←→</Key> Change  <Key>esc</Key> Back</Text>
      {resolved?.warnings.map(warning => <Text key={warning} color="yellow">Note: {warning}</Text>)}
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
        {selected?.candidate ? <><Key>enter</Key> Launch  <Key>x</Key> Advanced  </> : selected?.catalog?.downloadEnabled ? <><Key>d</Key> Download  </> : null}
        {selected?.library && <><Key>r</Key> Remove from library  </>}<Key>esc</Key> Back
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
        {capabilities && <Text>Context {formatTokens(capabilities.contextWindow)} · output budget {formatTokens(capabilities.maxOutputTokens)} · {capabilities.slots} slot{capabilities.slots === 1 ? '' : 's'}</Text>}
        {processExit && <Text {...(processStatus === 'failed' ? {color: 'red' as const} : {})}>{processExit}</Text>}
      </Box>
      {showLogs && <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Text bold dimColor>Logs</Text>
        {logs.slice(-12).map((line, index) => <Text key={`${index}:${line}`} wrap="truncate">{line}</Text>)}
      </Box>}
      <Text><Key>l</Key> {showLogs ? 'Hide logs' : 'Show logs'}  <Key>q</Key> {processStatus === 'starting' || processStatus === 'ready' ? 'Stop' : 'Back'}</Text>
    </Box>;
  }

  let lastSection: ModelRow['section'] | undefined;
  return <Box flexDirection="column">
    <Brand version={version}/>
    <Box justifyContent="space-between">
      <Box>
        <Text {...(runtime === 'tess-mlx' ? {color: 'magenta' as const} : {})} bold={runtime === 'tess-mlx'}>[ Tess MLX ]</Text>
        <Text>  </Text>
        <Text {...(runtime === 'gguf' ? {color: 'cyan' as const} : {})} bold={runtime === 'gguf'}>[ GGUF ]</Text>
      </Box>
      <Text dimColor>Server stopped · {Math.round(totalmem() / 1024 ** 3)} GiB Mac</Text>
    </Box>
    <Box flexDirection="column" borderStyle="round" borderColor={runtimeColor(runtime)} paddingX={1} marginTop={1}>
      {rows.length === 0 && <Text dimColor>No {runtimeName(runtime)} models to show.</Text>}
      {rows.map((row, index) => {
        const heading = row.section !== lastSection;
        lastSection = row.section;
        return <React.Fragment key={row.id}>
          {heading && <Text bold {...(row.section === 'Recommended' ? {color: 'yellow' as const} : {})}>{row.section}</Text>}
          <Box>
            <Text {...(index === selectedIndex ? {color: runtimeColor(runtime)} : {})} bold={index === selectedIndex}>{index === selectedIndex ? '› ' : '  '}</Text>
            <Box width={34}><Text bold={index === selectedIndex} wrap="truncate">{row.title}</Text></Box>
            <Box width={12}><Text color={runtimeColor(runtime)}>{runtimeName(runtime)}</Text></Box>
            <Box width={13}><Text>{row.candidate ? formatBytes(modelBytes(row.candidate)) : row.catalog ? formatBytes(row.catalog.diskBytes) : '—'}</Text></Box>
            <Text color={statusColor(row.status)}>{row.status}</Text>
          </Box>
        </React.Fragment>;
      })}
    </Box>
    <Text dimColor>{scanning ? 'Scanning local model folders… ' : ''}{message}</Text>
    <Text>
      <Key>tab/←→</Key> Runtime  <Key>↑↓</Key> Select  <Key>enter</Key> {selected?.candidate ? 'Launch' : 'Details'}  <Key>i</Key> Info
    </Text>
    <Text>
      {selected?.catalog?.downloadEnabled && !selected.candidate && <><Key>d</Key> Download  </>}<Key>b</Key> Browse  <Key>a</Key> Add path  <Key>,</Key> Settings  <Key>r</Key> Rescan  <Key>o</Key> {showOtherMacs ? 'Fit this Mac' : 'Other Macs'}  <Key>q</Key> Quit
    </Text>
    <Text dimColor>Catalog is bundled and offline · host catalog filter {hostMemoryGiB().toFixed(0)} GiB</Text>
  </Box>;
}
