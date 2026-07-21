import {type ChildProcess} from 'node:child_process';
import {resolve} from 'node:path';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text, useApp, useInput} from 'ink';
import {launchOverridesFromResolved, resolveProfileConfiguration} from '../configuration.js';
import {discoverModels} from '../discovery.js';
import {serveSpec, spawnCaptured, stopCaptured, verifySpec} from '../launch.js';
import {formatBytes, formatTokens} from '../profiles.js';
import {assertAuthKeyFile, assertPortAvailable, defaultServerSettings, saveServerSettings, validateServerSettings} from '../server-settings.js';
import type {LogoVariant} from '../branding.js';
import type {LaunchOverrides, ModelCandidate, ProfileDescriptor, ResolvedProfileConfiguration, ServerSettings} from '../types.js';
import {Brand} from './Brand.js';

type View = 'discovering' | 'models' | 'add-root' | 'details' | 'expert' | 'preview' | 'server' | 'process';
type ProcessMode = 'serve' | 'verify';
type ProcessStatus = 'starting' | 'ready' | 'stopping' | 'exited' | 'failed';
type ServerField = 'port' | 'alias' | 'auth' | 'key_file';
type ExpertField = 'context' | 'speculation' | 'draft_depth' | 'p_min' | 'reasoning' | 'preserve_reasoning' | 'kv_quality';

export interface AppProps {
  profiles: ProfileDescriptor[];
  payloadRoot: string;
  initialModelRoots: string[];
  initialServerSettings: ServerSettings;
  initialContext?: number;
  logo: LogoVariant;
  version: string;
}

const ansiPattern = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

function cleanLines(chunk: string): string[] {
  return chunk.replace(ansiPattern, '').split(/\r\n|\n|\r/).map(line => line.trimEnd()).filter(Boolean);
}

function modelSize(candidate: ModelCandidate): string {
  return formatBytes(candidate.profile.shards.reduce((sum, shard) => sum + shard.bytes, 0));
}

function Key({children}: {children: React.ReactNode}): React.JSX.Element {
  return <Text color="cyan">{children}</Text>;
}

function runtimeColor(resolved: ResolvedProfileConfiguration): 'green' | 'yellow' | 'red' {
  return resolved.runtimeLabel === 'verified' ? 'green' : resolved.runtimeLabel === 'custom' ? 'yellow' : 'red';
}

function cycle<T>(values: readonly T[], current: T, direction: number): T {
  const index = Math.max(values.indexOf(current), 0);
  return values[(index + direction + values.length) % values.length] ?? current;
}

export function App({profiles, payloadRoot, initialModelRoots, initialServerSettings, initialContext, logo, version}: AppProps): React.JSX.Element {
  const {exit} = useApp();
  const [view, setView] = useState<View>('discovering');
  const [roots, setRoots] = useState(initialModelRoots);
  const [refreshToken, setRefreshToken] = useState(0);
  const [candidates, setCandidates] = useState<ModelCandidate[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pathInput, setPathInput] = useState('');
  const [discoveryError, setDiscoveryError] = useState<string>();
  const [modelOverrides, setModelOverrides] = useState<Record<string, LaunchOverrides>>({});
  const [expertIndex, setExpertIndex] = useState(0);
  const [serverSettings, setServerSettings] = useState(initialServerSettings);
  const [serverDraft, setServerDraft] = useState(initialServerSettings);
  const [serverIndex, setServerIndex] = useState(0);
  const [serverInput, setServerInput] = useState<{field: ServerField; value: string}>();
  const [serverMessage, setServerMessage] = useState<string>();
  const [processMode, setProcessMode] = useState<ProcessMode>('serve');
  const [processStatus, setProcessStatus] = useState<ProcessStatus>('starting');
  const [processExit, setProcessExit] = useState<string>();
  const [logs, setLogs] = useState<string[]>([]);
  const [health, setHealth] = useState('waiting for server');
  const [processNonce, setProcessNonce] = useState(0);
  const [runningLabel, setRunningLabel] = useState('verified');
  const childRef = useRef<ChildProcess | undefined>(undefined);
  const stopTimerRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const selected = candidates[selectedIndex];
  const selectedOverrides = selected ? modelOverrides[selected.profile.profile_id] ?? {} : {};
  const resolved = useMemo(() => selected ? resolveProfileConfiguration(selected.profile, selectedOverrides) : undefined, [selected, selectedOverrides]);
  const expertFields = useMemo<ExpertField[]>(() => {
    if (!selected) return [];
    const fields: ExpertField[] = ['context'];
    if (selected.profile.expert.speculation) fields.push('speculation', 'draft_depth', 'p_min');
    if (selected.profile.expert.reasoning) fields.push('reasoning', 'preserve_reasoning');
    if (selected.profile.expert.kv_quality) fields.push('kv_quality');
    return fields;
  }, [selected]);
  const serverFields = useMemo<ServerField[]>(() => ['port', 'alias', 'auth', ...(serverDraft.auth.mode === 'file' ? ['key_file' as const] : [])], [serverDraft.auth.mode]);

  useEffect(() => {
    if (!selected || initialContext === undefined || modelOverrides[selected.profile.profile_id]?.context !== undefined) return;
    setModelOverrides(current => ({...current, [selected.profile.profile_id]: {...(current[selected.profile.profile_id] ?? {}), context: initialContext}}));
  }, [initialContext, selected?.profile.profile_id]);

  const refresh = useCallback(async () => {
    setView('discovering');
    setDiscoveryError(undefined);
    try {
      const discovered = await discoverModels(profiles, roots);
      setCandidates(discovered);
      setSelectedIndex(index => Math.min(index, Math.max(discovered.length - 1, 0)));
    } catch (error) {
      setDiscoveryError(error instanceof Error ? error.message : String(error));
    } finally {
      setView('models');
    }
  }, [profiles, roots.join('\u0000'), refreshToken]);

  useEffect(() => { void refresh(); }, [refresh]);

  const updateOverride = useCallback((patch: LaunchOverrides) => {
    if (!selected) return;
    setModelOverrides(current => ({...current, [selected.profile.profile_id]: {...(current[selected.profile.profile_id] ?? {}), ...patch}}));
  }, [selected]);

  const appendLog = useCallback((chunk: string) => {
    const next = cleanLines(chunk);
    if (next.length > 0) setLogs(current => [...current, ...next].slice(-18));
  }, []);

  const stopChild = useCallback(() => {
    const child = childRef.current;
    if (!child || child.exitCode !== null || child.killed) return;
    setProcessStatus('stopping');
    stopCaptured(child, 'SIGINT');
    stopTimerRef.current = setTimeout(() => { if (child.exitCode === null) stopCaptured(child, 'SIGTERM'); }, 5000);
  }, []);

  useEffect(() => () => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    const child = childRef.current;
    if (child && child.exitCode === null) stopCaptured(child, 'SIGTERM');
  }, []);

  const beginProcess = useCallback(async (mode: ProcessMode) => {
    if (!selected || !resolved) return;
    if (!selected.complete || (mode === 'serve' && !resolved.startable)) {
      setProcessMode(mode);
      setLogs([...selected.issues, ...(resolved.rejection ? [resolved.rejection] : [])]);
      setProcessStatus('failed');
      setProcessExit(!selected.complete ? 'model set is incomplete' : 'configuration rejected');
      setView('process');
      return;
    }
    setProcessMode(mode);
    setProcessStatus('starting');
    setProcessExit(undefined);
    setHealth(mode === 'serve' ? 'waiting for server' : 'not applicable');
    setLogs([mode === 'serve' ? `Starting ${resolved.runtimeLabel.toUpperCase()} profile launcher…` : 'Verifying model files…']);
    setRunningLabel(resolved.runtimeLabel);
    setView('process');
    try {
      if (mode === 'serve') {
        await assertAuthKeyFile(serverSettings);
        await assertPortAvailable(serverSettings.port);
      }
      const spec = mode === 'serve' ? serveSpec(payloadRoot, selected, {
        ...launchOverridesFromResolved(resolved),
        port: serverSettings.port,
        alias: serverSettings.alias,
        ...(serverSettings.auth.mode === 'file' ? {apiKeyFile: serverSettings.auth.key_file} : {}),
      }) : verifySpec(payloadRoot, selected);
      const child = spawnCaptured(spec);
      childRef.current = child;
      setProcessNonce(value => value + 1);
      child.stdout?.on('data', chunk => appendLog(String(chunk)));
      child.stderr?.on('data', chunk => appendLog(String(chunk)));
      child.once('error', error => { appendLog(error.message); setProcessStatus('failed'); setProcessExit('process could not start'); });
      child.once('exit', (code, signal) => {
        if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
        setProcessStatus(code === 0 ? 'exited' : 'failed');
        setProcessExit(code === null ? `signal ${signal ?? 'unknown'}` : `exit ${code}`);
      });
    } catch (error) {
      appendLog(error instanceof Error ? error.message : String(error));
      setProcessStatus('failed');
      setProcessExit('preflight failed');
    }
  }, [appendLog, payloadRoot, resolved, selected, serverSettings]);

  useEffect(() => {
    if (view !== 'process' || processMode !== 'serve' || processStatus === 'exited' || processStatus === 'failed') return;
    let cancelled = false;
    const check = async (): Promise<void> => {
      try {
        const response = await fetch(`http://127.0.0.1:${serverSettings.port}/health`, {signal: AbortSignal.timeout(900)});
        if (!cancelled && response.ok) { setHealth('ready'); setProcessStatus('ready'); }
        else if (!cancelled) setHealth(`loading (HTTP ${response.status})`);
      } catch { if (!cancelled) setHealth('loading'); }
    };
    void check();
    const timer = setInterval(() => void check(), 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [processMode, processNonce, processStatus, serverSettings.port, view]);

  const changeExpert = useCallback((direction: number) => {
    if (!selected || !resolved) return;
    const field = expertFields[expertIndex];
    if (field === 'context') {
      const values = selected.profile.expert.context_presets.map(preset => preset.tokens);
      updateOverride({context: cycle(values, resolved.context, direction)});
    } else if (field === 'speculation' && selected.profile.expert.speculation && resolved.speculation) {
      updateOverride({speculation: cycle(selected.profile.expert.speculation.options, resolved.speculation, direction)});
    } else if (field === 'draft_depth' && selected.profile.expert.speculation && resolved.draftDepth !== undefined) {
      const values = Array.from({length: selected.profile.expert.speculation.draft_depth_max - selected.profile.expert.speculation.draft_depth_min + 1}, (_, index) => selected.profile.expert.speculation!.draft_depth_min + index);
      updateOverride({draftDepth: cycle(values, resolved.draftDepth, direction)});
    } else if (field === 'p_min' && selected.profile.expert.speculation && resolved.pMin !== undefined) {
      updateOverride({pMin: cycle(selected.profile.expert.speculation.p_min_presets, resolved.pMin, direction)});
    } else if (field === 'reasoning' && selected.profile.expert.reasoning && resolved.reasoning) {
      updateOverride({reasoning: cycle(selected.profile.expert.reasoning.options, resolved.reasoning, direction)});
    } else if (field === 'preserve_reasoning' && resolved.preserveReasoning !== undefined && resolved.reasoning !== 'off') {
      updateOverride({preserveReasoning: !resolved.preserveReasoning});
    } else if (field === 'kv_quality' && selected.profile.expert.kv_quality && resolved.kvQuality) {
      updateOverride({kvQuality: cycle(selected.profile.expert.kv_quality.options.map(option => option.id), resolved.kvQuality, direction)});
    }
  }, [expertFields, expertIndex, resolved, selected, updateOverride]);

  useInput((input, key) => {
    if (view === 'add-root') {
      if (key.escape) { setPathInput(''); setView('models'); }
      else if (key.return) { const value = pathInput.trim(); if (value) setRoots(current => [...new Set([...current, resolve(value.replace(/^~(?=\/|$)/, process.env.HOME ?? '~'))])]); setPathInput(''); }
      else if (key.backspace || key.delete) setPathInput(value => value.slice(0, -1));
      else if (!key.ctrl && !key.meta && input) setPathInput(value => value + input);
      return;
    }
    if (view === 'server' && serverInput) {
      if (key.escape) setServerInput(undefined);
      else if (key.return) {
        const value = serverInput.value.trim();
        try {
          if (serverInput.field === 'port') setServerDraft(current => validateServerSettings({...current, port: Number(value)}));
          else if (serverInput.field === 'alias') setServerDraft(current => validateServerSettings({...current, alias: value}));
          else if (serverInput.field === 'key_file') setServerDraft(current => validateServerSettings({...current, auth: {mode: 'file', key_file: value}}));
          setServerMessage(undefined); setServerInput(undefined);
        } catch (error) { setServerMessage(error instanceof Error ? error.message : String(error)); }
      } else if (key.backspace || key.delete) setServerInput(current => current ? {...current, value: current.value.slice(0, -1)} : current);
      else if (!key.ctrl && !key.meta && input) setServerInput(current => current ? {...current, value: current.value + input} : current);
      return;
    }
    if (view === 'models') {
      if (key.upArrow && candidates.length > 0) setSelectedIndex(index => (index - 1 + candidates.length) % candidates.length);
      else if (key.downArrow && candidates.length > 0) setSelectedIndex(index => (index + 1) % candidates.length);
      else if (key.return && selected) setView('details');
      else if (input === 'c') { setServerDraft(serverSettings); setServerMessage(undefined); setView('server'); }
      else if (input === 'a') setView('add-root');
      else if (input === 'r') setRefreshToken(value => value + 1);
      else if (input === 'q' || key.escape) exit();
      return;
    }
    if (view === 'server') {
      if (key.upArrow) setServerIndex(index => (index - 1 + serverFields.length) % serverFields.length);
      else if (key.downArrow) setServerIndex(index => (index + 1) % serverFields.length);
      else if ((key.leftArrow || key.rightArrow) && serverFields[serverIndex] === 'auth') setServerDraft(current => ({...current, auth: current.auth.mode === 'off' ? {mode: 'file', key_file: ''} : {mode: 'off'}}));
      else if (key.return) {
        const field = serverFields[serverIndex];
        if (field === 'port') setServerInput({field, value: String(serverDraft.port)});
        if (field === 'alias') setServerInput({field, value: serverDraft.alias});
        if (field === 'key_file') setServerInput({field, value: serverDraft.auth.key_file ?? ''});
      } else if (input === 's') {
        void (async () => { try { const validated = validateServerSettings(serverDraft); await saveServerSettings(validated); setServerSettings(validated); setServerMessage('Saved. New launches use this server configuration.'); } catch (error) { setServerMessage(error instanceof Error ? error.message : String(error)); } })();
      } else if (input === 'r') { const reset = structuredClone(defaultServerSettings); setServerDraft(reset); setServerMessage('Reset to built-in defaults; press s to save.'); }
      else if (input === 'b' || key.escape) setView('models');
      return;
    }
    if (view === 'details') {
      if ((key.leftArrow || key.rightArrow) && selected && resolved) { const values = selected.profile.expert.context_presets.map(preset => preset.tokens); updateOverride({context: cycle(values, resolved.context, key.rightArrow ? 1 : -1)}); }
      else if (input === 'e') { setExpertIndex(0); setView('expert'); }
      else if (input === 'p') setView('preview');
      else if (input === 's') void beginProcess('serve');
      else if (input === 'v') void beginProcess('verify');
      else if (input === 'b' || key.escape) setView('models');
      else if (input === 'q') exit();
      return;
    }
    if (view === 'expert') {
      if (key.upArrow) setExpertIndex(index => (index - 1 + expertFields.length) % expertFields.length);
      else if (key.downArrow) setExpertIndex(index => (index + 1) % expertFields.length);
      else if (key.leftArrow || key.rightArrow) changeExpert(key.rightArrow ? 1 : -1);
      else if (input === 'r' && selected) setModelOverrides(current => ({...current, [selected.profile.profile_id]: {}}));
      else if (input === 'p') setView('preview');
      else if (input === 's') void beginProcess('serve');
      else if (input === 'b' || key.escape) setView('details');
      return;
    }
    if (view === 'preview') { if (input === 's') void beginProcess('serve'); else if (input === 'b' || key.escape) setView('expert'); return; }
    if (view === 'process') {
      const finished = processStatus === 'exited' || processStatus === 'failed';
      if ((input === 'q' || key.escape) && !finished) stopChild();
      else if ((key.return || input === 'b' || input === 'q' || key.escape) && finished) { childRef.current = undefined; setView('details'); }
    }
  }, {isActive: view !== 'discovering'});

  const modelRows = useMemo(() => candidates.map((candidate, index) => <Text key={`${candidate.profile.profile_id}:${candidate.modelPath}`} {...(index === selectedIndex ? {color: 'cyan' as const} : {})}>{index === selectedIndex ? '›' : ' '} {candidate.profile.model.name} · {candidate.profile.model.quant_label} · {modelSize(candidate)} · {candidate.complete ? 'ready' : 'incomplete'}</Text>), [candidates, selectedIndex]);

  const expertValue = (field: ExpertField): string => {
    if (!resolved || !selected) return '';
    if (field === 'context') return `${resolved.preset.label}${resolved.preset.experimental ? ' · Experimental' : ''}`;
    if (field === 'speculation') return resolved.speculation ?? '';
    if (field === 'draft_depth') return String(resolved.draftDepth ?? '');
    if (field === 'p_min') return String(resolved.pMin ?? '');
    if (field === 'reasoning') return resolved.reasoning === 'low' ? 'Low effort' : resolved.reasoning ?? '';
    if (field === 'preserve_reasoning') return resolved.preserveReasoning ? 'On' : 'Off';
    if (field === 'kv_quality') return selected.profile.expert.kv_quality?.options.find(option => option.id === resolved.kvQuality)?.label ?? '';
    return '';
  };

  return <Box flexDirection="column" paddingX={1}>
    <Brand variant={logo} version={version} compact={view !== 'discovering' && view !== 'models'} />
    {view === 'discovering' && <Text color="yellow">Scanning configured model folders…</Text>}
    {view === 'models' && <Box flexDirection="column"><Text bold>Models</Text>{discoveryError && <Text color="red">{discoveryError}</Text>}{modelRows.length > 0 ? modelRows : <Text color="yellow">No profile-matched models found.</Text>}<Box marginTop={1}><Text>Server  127.0.0.1:{serverSettings.port} · auth {serverSettings.auth.mode === 'file' ? 'bearer' : 'off'} · model {serverSettings.alias}</Text></Box><Box marginTop={1}><Text><Key>↑/↓</Key> select  <Key>enter</Key> details  <Key>c</Key> configure server  <Key>a</Key> add folder  <Key>r</Key> rescan  <Key>q</Key> quit</Text></Box></Box>}
    {view === 'add-root' && <Box flexDirection="column"><Text bold>Add model folder</Text><Text>Path: <Text color="cyan">{pathInput}</Text><Text inverse> </Text></Text><Text dimColor>Enter to scan · Esc to cancel</Text></Box>}
    {view === 'server' && <Box flexDirection="column"><Text bold color="cyan">Configure Server</Text><Text dimColor>Host is locked to 127.0.0.1 for profile launches.</Text>{serverFields.map((field, index) => <Text key={field} {...(index === serverIndex ? {color: 'cyan' as const} : {})}>{index === serverIndex ? '›' : ' '} {field === 'port' ? `Port              ${serverDraft.port}` : field === 'alias' ? `API model name    ${serverDraft.alias}` : field === 'auth' ? `Authentication    ${serverDraft.auth.mode === 'file' ? 'Bearer · file-backed' : 'Off'}` : `API key file      ${serverDraft.auth.key_file || '(set path)'}`}</Text>)}{serverInput && <Text>Enter {serverInput.field}: <Text color="cyan">{serverInput.value}</Text><Text inverse> </Text></Text>}{serverMessage && <Text color={serverMessage.startsWith('Saved') ? 'green' : 'yellow'}>{serverMessage}</Text>}<Box marginTop={1}><Text><Key>↑/↓</Key> select  <Key>enter</Key> edit  <Key>←/→</Key> toggle  <Key>s</Key> save  <Key>r</Key> reset  <Key>b</Key> back</Text></Box></Box>}
    {view === 'details' && selected && resolved && <Box flexDirection="column"><Text bold color="cyan">{selected.profile.model.name}  <Text color={runtimeColor(resolved)}>{resolved.runtimeLabel.toUpperCase()}</Text></Text><Text>{selected.profile.model.quant_label}</Text><Text>Profile: {selected.profile.profile_id}</Text><Text>Model: {selected.modelPath}</Text><Text>Size: {modelSize(selected)} · RAM class: {selected.profile.memory.ram_class_gib} GiB</Text><Text>Context: <Text color="cyan">{resolved.preset.label}</Text> selected · {formatTokens(selected.profile.context.default)} default · {formatTokens(selected.profile.context.qualified ?? selected.profile.context.validated)} qualified · {formatTokens(selected.profile.context.trained)} trained</Text>{selected.profile.context.validated_prompt && <Text>Evidence: {selected.profile.context.validated_prompt.toLocaleString()}-token prompt{selected.profile.context.validated_generation ? ` + ${selected.profile.context.validated_generation.toLocaleString()} generated` : ''}</Text>}<Text>Managed: batch/ubatch {resolved.batch.toLocaleString()}/{resolved.ubatch.toLocaleString()} · KV {resolved.kvType} · slots {selected.profile.runtime.slots}</Text><Text>Endpoint: http://127.0.0.1:{serverSettings.port}/v1 · auth {serverSettings.auth.mode === 'file' ? 'bearer' : 'off'}</Text>{resolved.preset.requires_wired_limit_mb && <Box flexDirection="column"><Text color="yellow">Requires GPU wired limit: {resolved.preset.requires_wired_limit_mb.toLocaleString()} MiB</Text><Text>Run once per boot: <Text color="cyan">sudo sysctl iogpu.wired_limit_mb={resolved.preset.requires_wired_limit_mb}</Text></Text><Text dimColor>Tess Server never runs this command or requests root.</Text></Box>}{resolved.rejection && <Text color="red">REJECTED: {resolved.rejection}</Text>}{resolved.deltas.map(delta => <Text key={delta} color="yellow">• {delta}</Text>)}{selected.profile.limitations.slice(0, 2).map(limitation => <Text key={limitation} dimColor>• {limitation}</Text>)}<Box marginTop={1}><Text><Key>←/→</Key> context  <Key>e</Key> expert options  <Key>p</Key> preview  <Key>s</Key> start  <Key>v</Key> verify  <Key>b</Key> back</Text></Box></Box>}
    {view === 'expert' && selected && resolved && <Box flexDirection="column"><Text bold color="cyan">{selected.profile.model.name} · Expert options  <Text color={runtimeColor(resolved)}>{resolved.runtimeLabel.toUpperCase()}</Text></Text>{expertFields.map((field, index) => <Text key={field} {...(index === expertIndex ? {color: 'cyan' as const} : {})}>{index === expertIndex ? '›' : ' '} {field.replaceAll('_', ' ').padEnd(22)} {expertValue(field)}</Text>)}<Text dimColor>Ubatch                  Auto → {resolved.ubatch.toLocaleString()} · locked</Text>{resolved.deltas.length > 0 && <Box flexDirection="column" marginTop={1}><Text bold>Custom deltas</Text>{resolved.deltas.map(delta => <Text key={delta}>• {delta}</Text>)}</Box>}{resolved.warnings.map(warning => <Text key={warning} color="yellow">• {warning}</Text>)}{resolved.rejection && <Text color="red">REJECTED: {resolved.rejection}</Text>}<Box marginTop={1}><Text><Key>↑/↓</Key> select  <Key>←/→</Key> change  <Key>r</Key> reset  <Key>p</Key> preview  <Key>s</Key> start  <Key>b</Key> back</Text></Box></Box>}
    {view === 'preview' && selected && resolved && <Box flexDirection="column"><Text bold>Effective configuration · <Text color={runtimeColor(resolved)}>{resolved.runtimeLabel.toUpperCase()}</Text></Text><Text>Profile: {selected.profile.profile_id}</Text><Text>Context: {resolved.context.toLocaleString()} · batch/ubatch {resolved.batch}/{resolved.ubatch} · KV {resolved.kvType}</Text>{resolved.speculation && <Text>Speculation: {resolved.speculation}{resolved.speculation === 'dspark' ? ` · depth ${resolved.draftDepth} · p_min ${resolved.pMin}` : ''}</Text>}{resolved.reasoning && <Text>Reasoning: {resolved.reasoning} · preserve {resolved.preserveReasoning ? 'on' : 'off'}</Text>}<Text>Endpoint: http://127.0.0.1:{serverSettings.port}/v1 · model {serverSettings.alias} · auth {serverSettings.auth.mode === 'file' ? 'bearer' : 'off'}</Text>{resolved.deltas.map(delta => <Text key={delta}>Delta: {delta}</Text>)}{resolved.rejection && <Text color="red">Start blocked: {resolved.rejection}</Text>}<Box marginTop={1}><Text><Key>s</Key> start  <Key>b</Key> back</Text></Box></Box>}
    {view === 'process' && <Box flexDirection="column"><Text bold>{processMode === 'serve' ? 'Server' : 'Verification'} · {runningLabel.toUpperCase()} · <Text color={processStatus === 'failed' ? 'red' : processStatus === 'ready' ? 'green' : 'yellow'}>{processStatus}</Text></Text>{processMode === 'serve' && <Text>Health: {health} · http://127.0.0.1:{serverSettings.port}/v1 · auth {serverSettings.auth.mode === 'file' ? 'bearer' : 'off'}</Text>}{processExit && <Text {...(processStatus === 'failed' ? {color: 'red' as const} : {})}>{processExit}</Text>}<Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginTop={1}>{logs.length > 0 ? logs.map((line, index) => <Text key={`${index}:${line}`} wrap="truncate-end">{line}</Text>) : <Text dimColor>Waiting for output…</Text>}</Box><Box marginTop={1}><Text>{processStatus === 'exited' || processStatus === 'failed' ? <><Key>enter</Key> back</> : <><Key>q</Key> stop</>}</Text></Box></Box>}
  </Box>;
}
