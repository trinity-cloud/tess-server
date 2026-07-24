import {type ChildProcess} from 'node:child_process';
import {basename, resolve} from 'node:path';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text, useApp, useInput} from 'ink';
import {genericBatchChoices, genericChatTemplateChoices, genericContextChoices, genericFlashAttentionChoices, genericGpuLayerChoices, genericKvChoices, genericReasoningChoices, genericReasoningFormatChoices, genericSlotChoices, genericSpeculationChoices, genericTriStateChoices, genericUbatchChoices, launchOverridesFromResolved, resolveProfileConfiguration, resolveUnprofiledConfiguration} from '../configuration.js';
import {discoverModels} from '../discovery.js';
import {serveSpec, spawnCaptured, stopCaptured, verifySpec} from '../launch.js';
import {formatBytes, formatTokens} from '../profiles.js';
import {assertAuthKeyFile, assertPortAvailable, defaultServerSettings, saveServerSettings, validateServerSettings} from '../server-settings.js';
import type {LaunchOverrides, ModelCandidate, ProfileDescriptor, ResolvedProfileConfiguration, ServerSettings} from '../types.js';
import {Brand} from './Brand.js';

type View = 'discovering' | 'models' | 'add-root' | 'details' | 'expert' | 'generic' | 'preview' | 'server' | 'process';
type ProcessMode = 'serve' | 'verify';
type ProcessStatus = 'starting' | 'ready' | 'stopping' | 'exited' | 'failed';
type ServerField = 'port' | 'alias' | 'auth' | 'key_file';
type ExpertField = 'context' | 'speculation' | 'draft_depth' | 'p_min' | 'reasoning' | 'preserve_reasoning' | 'kv_quality';
type GenericField = 'context' | 'batch' | 'ubatch' | 'cache_type_k' | 'cache_type_v' | 'gpu_layers' | 'flash_attention' | 'slots' | 'mmap' | 'mlock' | 'jinja' | 'chat_template' | 'reasoning' | 'reasoning_format' | 'reasoning_budget' | 'reasoning_preserve' | 'mmproj' | 'speculation' | 'draft_model' | 'draft_depth' | 'p_min' | 'extra_args';
type GenericInputField = 'context' | 'batch' | 'ubatch' | 'gpu_layers' | 'slots' | 'chat_template' | 'reasoning_budget' | 'draft_depth' | 'p_min' | 'mmproj' | 'draft_model' | 'extra_args';

export interface AppProps {
  profiles: ProfileDescriptor[];
  payloadRoot: string;
  initialModelRoots: string[];
  initialServerSettings: ServerSettings;
  initialContext?: number;
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
  return resolved.runtimeLabel === 'verified' ? 'green' : resolved.runtimeLabel === 'rejected' ? 'red' : 'yellow';
}

function cycle<T>(values: readonly T[], current: T, direction: number): T {
  const index = Math.max(values.indexOf(current), 0);
  return values[(index + direction + values.length) % values.length] ?? current;
}

function genericInputPatch(field: GenericInputField, rawValue: string): LaunchOverrides {
  const value = rawValue.trim();
  const integer = (): number => {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error(`${field.replaceAll('_', ' ')} must be an integer`);
    return parsed;
  };
  if (field === 'context') return {context: integer()};
  if (field === 'batch') return {batch: integer()};
  if (field === 'ubatch') return {ubatch: integer()};
  if (field === 'gpu_layers') return {gpuLayers: value};
  if (field === 'slots') return {slots: integer()};
  if (field === 'chat_template') return {chatTemplate: value};
  if (field === 'reasoning_budget') return {reasoningBudget: integer()};
  if (field === 'draft_depth') return {draftDepth: integer()};
  if (field === 'p_min') return {pMin: Number(value)};
  if (field === 'mmproj') return {mmproj: value};
  if (field === 'draft_model') return {draftModel: value};
  return {rawEngineArgs: value};
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

function genericLabel(field: GenericField | GenericInputField): string {
  const labels: Record<GenericField, string> = {
    context: 'Context', batch: 'Batch', ubatch: 'Ubatch', cache_type_k: 'KV cache K', cache_type_v: 'KV cache V',
    gpu_layers: 'GPU layers', flash_attention: 'Flash Attention', slots: 'Slots', mmap: 'mmap', mlock: 'mlock',
    jinja: 'Jinja', chat_template: 'Chat template', reasoning: 'Reasoning', reasoning_format: 'Reasoning format',
    reasoning_budget: 'Reasoning budget', reasoning_preserve: 'Preserve reasoning', mmproj: 'Multimodal projector',
    speculation: 'Speculation type', draft_model: 'Draft / MTP model', draft_depth: 'Draft depth',
    p_min: 'Acceptance threshold', extra_args: 'Extra engine args',
  };
  return labels[field];
}

export function App({profiles, payloadRoot, initialModelRoots, initialServerSettings, initialContext, version}: AppProps): React.JSX.Element {
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
  const [genericIndex, setGenericIndex] = useState(0);
  const [genericInput, setGenericInput] = useState<{field: GenericInputField; value: string}>();
  const [genericMessage, setGenericMessage] = useState<string>();
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
  const resolved = useMemo(() => selected ? selected.kind === 'profiled' ? resolveProfileConfiguration(selected.profile, selectedOverrides) : resolveUnprofiledConfiguration(selected, selectedOverrides) : undefined, [selected, selectedOverrides]);
  const expertFields = useMemo<ExpertField[]>(() => {
    if (!selected) return [];
    const fields: ExpertField[] = ['context'];
    if (selected.kind === 'unprofiled') return fields;
    if (selected.profile.expert.speculation) fields.push('speculation', 'draft_depth', 'p_min');
    if (selected.profile.expert.reasoning) fields.push('reasoning', 'preserve_reasoning');
    if (selected.profile.expert.kv_quality) fields.push('kv_quality');
    return fields;
  }, [selected]);
  const genericFields = useMemo<GenericField[]>(() => {
    const fields: GenericField[] = ['context', 'batch', 'ubatch', 'cache_type_k', 'cache_type_v', 'gpu_layers', 'flash_attention', 'slots', 'mmap', 'mlock', 'jinja', 'chat_template', 'reasoning', 'reasoning_format', 'reasoning_budget', 'reasoning_preserve', 'mmproj', 'speculation'];
    if (resolved?.runtimeLabel === 'unprofiled' && resolved.speculationType !== 'none') fields.push('draft_model', 'draft_depth', 'p_min');
    fields.push('extra_args');
    return fields;
  }, [resolved?.runtimeLabel, resolved?.speculationType]);
  const genericCommand = useMemo(() => {
    if (!selected || selected.kind !== 'unprofiled') return '';
    const spec = serveSpec(payloadRoot, selected, {
      ...selectedOverrides,
      port: serverSettings.port,
      alias: serverSettings.alias,
      ...(serverSettings.auth.mode === 'file' ? {apiKeyFile: serverSettings.auth.key_file} : {}),
    });
    return `tess-server engine -- ${spec.args.map(shellQuote).join(' ')}`;
  }, [payloadRoot, selected, selectedOverrides, serverSettings]);
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

  const updateGenericOverride = useCallback((patch: LaunchOverrides): boolean => {
    if (!selected || selected.kind !== 'unprofiled') return false;
    const next = {...selectedOverrides, ...patch};
    try {
      resolveUnprofiledConfiguration(selected, next);
      setModelOverrides(current => ({...current, [selected.profile.profile_id]: next}));
      setGenericMessage(undefined);
      return true;
    } catch (error) {
      setGenericMessage(error instanceof Error ? error.message : String(error));
      return false;
    }
  }, [selected, selectedOverrides]);

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
    if (mode === 'verify' && selected.kind !== 'profiled') {
      setProcessMode(mode);
      setLogs(['Unprofiled GGUF files do not have a Tess verification manifest.']);
      setProcessStatus('failed');
      setProcessExit('verification unavailable');
      setView('process');
      return;
    }
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
    setLogs([mode === 'serve' ? selected.kind === 'profiled' ? `Starting ${resolved.runtimeLabel.toUpperCase()} profile launcher…` : 'Starting UNPROFILED generic engine launch…' : 'Verifying model files…']);
    setRunningLabel(resolved.runtimeLabel);
    setView('process');
    try {
      if (mode === 'serve') {
        await assertAuthKeyFile(serverSettings);
        await assertPortAvailable(serverSettings.port);
      }
      const spec = mode === 'serve' ? serveSpec(payloadRoot, selected, {
        ...(selected.kind === 'profiled' ? launchOverridesFromResolved(resolved) : selectedOverrides),
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
  }, [appendLog, payloadRoot, resolved, selected, selectedOverrides, serverSettings]);

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

  const changeGeneric = useCallback((direction: number) => {
    if (!selected || selected.kind !== 'unprofiled' || !resolved) return;
    const field = genericFields[genericIndex];
    if (field === 'context') updateGenericOverride({context: cycle(genericContextChoices, resolved.context, direction)});
    else if (field === 'batch') updateGenericOverride({batch: cycle(genericBatchChoices, resolved.batch, direction)});
    else if (field === 'ubatch') updateGenericOverride({ubatch: cycle(genericUbatchChoices.filter(value => value <= resolved.batch), resolved.ubatch, direction)});
    else if (field === 'cache_type_k' && resolved.cacheTypeK) updateGenericOverride({cacheTypeK: cycle(genericKvChoices, resolved.cacheTypeK, direction)});
    else if (field === 'cache_type_v' && resolved.cacheTypeV) updateGenericOverride({cacheTypeV: cycle(genericKvChoices, resolved.cacheTypeV, direction)});
    else if (field === 'gpu_layers' && resolved.gpuLayers) updateGenericOverride({gpuLayers: cycle(genericGpuLayerChoices, resolved.gpuLayers as typeof genericGpuLayerChoices[number], direction)});
    else if (field === 'flash_attention' && resolved.flashAttention) updateGenericOverride({flashAttention: cycle(genericFlashAttentionChoices, resolved.flashAttention, direction)});
    else if (field === 'slots' && resolved.slots) updateGenericOverride({slots: cycle(genericSlotChoices, resolved.slots, direction)});
    else if (field === 'mmap') updateGenericOverride({mmap: !resolved.mmap});
    else if (field === 'mlock') updateGenericOverride({mlock: !resolved.mlock});
    else if (field === 'jinja') updateGenericOverride({jinja: !resolved.jinja});
    else if (field === 'chat_template') updateGenericOverride({chatTemplate: cycle(genericChatTemplateChoices, resolved.chatTemplate ?? '', direction)});
    else if (field === 'reasoning' && resolved.genericReasoning) updateGenericOverride({genericReasoning: cycle(genericReasoningChoices, resolved.genericReasoning, direction)});
    else if (field === 'reasoning_format' && resolved.reasoningFormat) updateGenericOverride({reasoningFormat: cycle(genericReasoningFormatChoices, resolved.reasoningFormat, direction)});
    else if (field === 'reasoning_budget' && resolved.reasoningBudget !== undefined) updateGenericOverride({reasoningBudget: cycle([-1, 0, 1024, 4096, 8192], resolved.reasoningBudget, direction)});
    else if (field === 'reasoning_preserve' && resolved.reasoningPreserve) updateGenericOverride({reasoningPreserve: cycle(genericTriStateChoices, resolved.reasoningPreserve, direction)});
    else if (field === 'mmproj') updateGenericOverride({mmproj: cycle(['', ...(selected.companions?.mmproj ?? [])], resolved.mmproj ?? '', direction)});
    else if (field === 'speculation' && resolved.speculationType) updateGenericOverride({speculationType: cycle(genericSpeculationChoices, resolved.speculationType, direction)});
    else if (field === 'draft_model') updateGenericOverride({draftModel: cycle(['', ...(selected.companions?.draft ?? [])], resolved.draftModel ?? '', direction)});
    else if (field === 'draft_depth' && resolved.draftDepth !== undefined) updateGenericOverride({draftDepth: cycle([1, 2, 3, 4, 5, 6, 7, 8], resolved.draftDepth, direction)});
    else if (field === 'p_min' && resolved.pMin !== undefined) updateGenericOverride({pMin: cycle([0, 0.3, 0.5, 0.7, 0.9], resolved.pMin, direction)});
  }, [genericFields, genericIndex, resolved, selected, updateGenericOverride]);

  const beginGenericInput = useCallback(() => {
    if (!resolved) return;
    const field = genericFields[genericIndex];
    const editable = new Set<GenericField>(['context', 'batch', 'ubatch', 'gpu_layers', 'slots', 'chat_template', 'reasoning_budget', 'draft_depth', 'p_min', 'mmproj', 'draft_model', 'extra_args']);
    if (!field || !editable.has(field)) return;
    const values: Partial<Record<GenericInputField, string>> = {
      context: String(resolved.context),
      batch: String(resolved.batch),
      ubatch: String(resolved.ubatch),
      gpu_layers: resolved.gpuLayers ?? 'all',
      slots: String(resolved.slots ?? 1),
      chat_template: resolved.chatTemplate ?? '',
      reasoning_budget: String(resolved.reasoningBudget ?? -1),
      draft_depth: String(resolved.draftDepth ?? 3),
      p_min: String(resolved.pMin ?? 0),
      mmproj: resolved.mmproj ?? '',
      draft_model: resolved.draftModel ?? '',
      extra_args: resolved.rawEngineArgs ?? '',
    };
    setGenericInput({field: field as GenericInputField, value: values[field as GenericInputField] ?? ''});
    setGenericMessage(undefined);
  }, [genericFields, genericIndex, resolved]);

  useInput((input, key) => {
    if (view === 'add-root') {
      if (key.escape) { setPathInput(''); setView('models'); }
      else if (key.return) { const value = pathInput.trim(); if (value) setRoots(current => [...new Set([...current, resolve(value.replace(/^~(?=\/|$)/, process.env.HOME ?? '~'))])]); setPathInput(''); }
      else if (key.backspace || key.delete) setPathInput(value => value.slice(0, -1));
      else if (!key.ctrl && !key.meta && input) setPathInput(value => value + input);
      return;
    }
    if (view === 'generic' && genericInput) {
      if (key.escape) setGenericInput(undefined);
      else if (key.return) {
        try {
          const patch = genericInputPatch(genericInput.field, genericInput.value);
          if (updateGenericOverride(patch)) setGenericInput(undefined);
        } catch (error) {
          setGenericMessage(error instanceof Error ? error.message : String(error));
        }
      } else if (key.backspace || key.delete) setGenericInput(current => current ? {...current, value: current.value.slice(0, -1)} : current);
      else if (!key.ctrl && !key.meta && input) setGenericInput(current => current ? {...current, value: current.value + input} : current);
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
      else if (input === 'e' && selected?.kind === 'profiled') { setExpertIndex(0); setView('expert'); }
      else if (input === 'e' && selected?.kind === 'unprofiled') { setGenericIndex(0); setGenericMessage(undefined); setView('generic'); }
      else if (input === 'p') setView('preview');
      else if (input === 's') void beginProcess('serve');
      else if (input === 'v' && selected?.kind === 'profiled') void beginProcess('verify');
      else if (input === 'b' || key.escape) setView('models');
      else if (input === 'q') exit();
      return;
    }
    if (view === 'generic') {
      if (key.upArrow) setGenericIndex(index => (index - 1 + genericFields.length) % genericFields.length);
      else if (key.downArrow) setGenericIndex(index => (index + 1) % genericFields.length);
      else if (key.leftArrow || key.rightArrow) changeGeneric(key.rightArrow ? 1 : -1);
      else if (key.return) beginGenericInput();
      else if (input === 'r' && selected) { setModelOverrides(current => ({...current, [selected.profile.profile_id]: {}})); setGenericMessage('Reset to detected defaults.'); }
      else if (input === 'p') setView('preview');
      else if (input === 's') void beginProcess('serve');
      else if (input === 'b' || key.escape) { setGenericInput(undefined); setView('details'); }
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
    if (view === 'preview') { if (input === 's') void beginProcess('serve'); else if (input === 'b' || key.escape) setView(selected?.kind === 'unprofiled' ? 'generic' : 'expert'); return; }
    if (view === 'process') {
      const finished = processStatus === 'exited' || processStatus === 'failed';
      if ((input === 'q' || key.escape) && !finished) stopChild();
      else if ((key.return || input === 'b' || input === 'q' || key.escape) && finished) { childRef.current = undefined; setView('details'); }
    }
  }, {isActive: view !== 'discovering'});

  const modelRows = useMemo(() => {
    const row = (candidate: ModelCandidate, index: number): React.JSX.Element => {
      const descriptor = candidate.kind === 'profiled' ? candidate.profile.model.quant_label.replace(/ profile build$/i, '') : candidate.profile.model.quant_label;
      return <Text key={`${candidate.profile.profile_id}:${candidate.modelPath}`} {...(index === selectedIndex ? {color: 'cyan' as const} : {})}>{index === selectedIndex ? '›' : ' '} {candidate.profile.model.name} · {descriptor} · {modelSize(candidate)} · {candidate.kind === 'profiled' ? candidate.complete ? 'ready' : 'incomplete' : candidate.complete ? 'best-effort' : 'incomplete'}</Text>;
    };
    return {
      profiled: candidates.map((candidate, index) => candidate.kind === 'profiled' ? row(candidate, index) : undefined).filter((item): item is React.JSX.Element => Boolean(item)),
      unprofiled: candidates.map((candidate, index) => candidate.kind === 'unprofiled' ? row(candidate, index) : undefined).filter((item): item is React.JSX.Element => Boolean(item)),
    };
  }, [candidates, selectedIndex]);

  const expertValue = (field: ExpertField): string => {
    if (!resolved || !selected) return '';
    if (field === 'context') {
      const status = resolved.preset.availability === 'qualification-pending' ? ' · Untested' : resolved.preset.experimental ? ' · Experimental' : '';
      return `${resolved.preset.label}${status}`;
    }
    if (field === 'speculation') return resolved.speculation ?? '';
    if (field === 'draft_depth') return String(resolved.draftDepth ?? '');
    if (field === 'p_min') return String(resolved.pMin ?? '');
    if (field === 'reasoning') return resolved.reasoning === 'low' ? 'Low effort' : resolved.reasoning ?? '';
    if (field === 'preserve_reasoning') return resolved.preserveReasoning ? 'On' : 'Off';
    if (field === 'kv_quality') return selected.profile.expert.kv_quality?.options.find(option => option.id === resolved.kvQuality)?.label ?? '';
    return '';
  };

  const genericValue = (field: GenericField): string => {
    if (!resolved || !selected || selected.kind !== 'unprofiled') return '';
    if (field === 'context') return resolved.preset.label;
    if (field === 'batch') return resolved.batch.toLocaleString();
    if (field === 'ubatch') return resolved.ubatch.toLocaleString();
    if (field === 'cache_type_k') return resolved.cacheTypeK ?? 'f16';
    if (field === 'cache_type_v') return resolved.cacheTypeV ?? 'f16';
    if (field === 'gpu_layers') return resolved.gpuLayers ?? 'all';
    if (field === 'flash_attention') return resolved.flashAttention ?? 'auto';
    if (field === 'slots') return String(resolved.slots ?? 1);
    if (field === 'mmap') return resolved.mmap ? 'On' : 'Off';
    if (field === 'mlock') return resolved.mlock ? 'On' : 'Off';
    if (field === 'jinja') return resolved.jinja ? 'On' : 'Off';
    if (field === 'chat_template') return resolved.chatTemplate || 'Model metadata (auto)';
    if (field === 'reasoning') return resolved.genericReasoning ?? 'auto';
    if (field === 'reasoning_format') return resolved.reasoningFormat ?? 'auto';
    if (field === 'reasoning_budget') return resolved.reasoningBudget === -1 ? 'Unlimited (-1)' : String(resolved.reasoningBudget ?? -1);
    if (field === 'reasoning_preserve') return resolved.reasoningPreserve ?? 'auto';
    if (field === 'mmproj') return resolved.mmproj ? `${basename(resolved.mmproj)}${resolved.mmproj === selected.companions?.recommendedMmproj ? ' · detected' : ''}` : 'None';
    if (field === 'speculation') return resolved.speculationType ?? 'none';
    if (field === 'draft_model') return resolved.draftModel ? `${basename(resolved.draftModel)}${resolved.draftModel === selected.companions?.recommendedDraft ? ' · detected' : ''}` : 'None / embedded';
    if (field === 'draft_depth') return String(resolved.draftDepth ?? 3);
    if (field === 'p_min') return String(resolved.pMin ?? 0);
    return resolved.rawEngineArgs || 'None';
  };

  return <Box flexDirection="column" paddingX={1}>
    <Brand version={version} />
    {view === 'discovering' && <Text color="yellow">Scanning configured model folders…</Text>}
    {view === 'models' && <Box flexDirection="column">
      {discoveryError && <Text color="red">{discoveryError}</Text>}
      {modelRows.profiled.length > 0 && <Box flexDirection="column"><Text bold>Profiled Models</Text>{modelRows.profiled}</Box>}
      {modelRows.unprofiled.length > 0 && <Box flexDirection="column" marginTop={modelRows.profiled.length > 0 ? 1 : 0}><Text bold>Unprofiled Models</Text>{modelRows.unprofiled}<Text dimColor>Best-effort generic launch · no Tess verification or performance claim</Text></Box>}
      {candidates.length === 0 && <Text color="yellow">No GGUF models found.</Text>}
      <Box marginTop={1}><Text>Server  127.0.0.1:{serverSettings.port} · auth {serverSettings.auth.mode === 'file' ? 'bearer' : 'off'} · model {serverSettings.alias}</Text></Box>
      <Box marginTop={1}><Text><Key>↑/↓</Key> select  <Key>enter</Key> details  <Key>c</Key> configure server  <Key>a</Key> add folder  <Key>r</Key> rescan  <Key>q</Key> quit</Text></Box>
    </Box>}
    {view === 'add-root' && <Box flexDirection="column"><Text bold>Add model folder</Text><Text>Path: <Text color="cyan">{pathInput}</Text><Text inverse> </Text></Text><Text dimColor>Enter to scan · Esc to cancel</Text></Box>}
    {view === 'server' && <Box flexDirection="column"><Text bold color="cyan">Configure Server</Text><Text dimColor>Host is locked to 127.0.0.1 for managed launches.</Text>{serverFields.map((field, index) => <Text key={field} {...(index === serverIndex ? {color: 'cyan' as const} : {})}>{index === serverIndex ? '›' : ' '} {field === 'port' ? `Port              ${serverDraft.port}` : field === 'alias' ? `API model name    ${serverDraft.alias}` : field === 'auth' ? `Authentication    ${serverDraft.auth.mode === 'file' ? 'Bearer · file-backed' : 'Off'}` : `API key file      ${serverDraft.auth.key_file || '(set path)'}`}</Text>)}{serverInput && <Text>Enter {serverInput.field}: <Text color="cyan">{serverInput.value}</Text><Text inverse> </Text></Text>}{serverMessage && <Text color={serverMessage.startsWith('Saved') ? 'green' : 'yellow'}>{serverMessage}</Text>}<Box marginTop={1}><Text><Key>↑/↓</Key> select  <Key>enter</Key> edit  <Key>←/→</Key> toggle  <Key>s</Key> save  <Key>r</Key> reset  <Key>b</Key> back</Text></Box></Box>}
    {view === 'details' && selected && resolved && (selected.kind === 'profiled' ? <Box flexDirection="column">
      <Text bold color="cyan">{selected.profile.model.name}  <Text color={runtimeColor(resolved)}>{resolved.runtimeLabel.toUpperCase()}</Text></Text>
      <Text>{selected.profile.model.quant_label}</Text>
      <Text>Profile: {selected.profile.profile_id}</Text>
      <Text>Model: {selected.modelPath}</Text>
      <Text>Size: {modelSize(selected)} · RAM class: {selected.profile.memory.ram_class_gib} GiB</Text>
      <Text>Context: <Text color="cyan">{resolved.preset.label}</Text> selected · {formatTokens(selected.profile.context.default)} default · {formatTokens(selected.profile.context.qualified ?? selected.profile.context.validated)} qualified · {formatTokens(selected.profile.context.trained)} trained</Text>
      {selected.profile.context.validated_prompt && <Text>Evidence: {selected.profile.context.validated_prompt.toLocaleString()}-token prompt{selected.profile.context.validated_generation ? ` + ${selected.profile.context.validated_generation.toLocaleString()} generated` : ''}</Text>}
      <Text>Managed: batch/ubatch {resolved.batch.toLocaleString()}/{resolved.ubatch.toLocaleString()} · KV {resolved.kvType} · slots {selected.profile.runtime.slots}</Text>
      <Text>Endpoint: http://127.0.0.1:{serverSettings.port}/v1 · auth {serverSettings.auth.mode === 'file' ? 'bearer' : 'off'}</Text>
      {resolved.preset.requires_wired_limit_mb && <Box flexDirection="column"><Text color="yellow">Requires GPU wired limit: {resolved.preset.requires_wired_limit_mb.toLocaleString()} MiB</Text><Text>Run once per boot: <Text color="cyan">sudo sysctl iogpu.wired_limit_mb={resolved.preset.requires_wired_limit_mb}</Text></Text><Text dimColor>Tess Server never runs this command or requests root.</Text></Box>}
      {resolved.rejection && <Text color="red">REJECTED: {resolved.rejection}</Text>}
      {resolved.deltas.map(delta => <Text key={delta} color="yellow">• {delta}</Text>)}
      {resolved.warnings.map(warning => <Text key={warning} color="yellow">• {warning}</Text>)}
      {selected.profile.limitations.slice(0, 2).map(limitation => <Text key={limitation} dimColor>• {limitation}</Text>)}
      <Box marginTop={1}><Text><Key>←/→</Key> context  <Key>e</Key> expert options  <Key>p</Key> preview  <Key>s</Key> start  <Key>v</Key> verify  <Key>b</Key> back</Text></Box>
    </Box> : <Box flexDirection="column">
      <Text bold color="cyan">{selected.profile.model.name}  <Text color="yellow">UNPROFILED</Text></Text>
      <Text>Generic GGUF · best-effort launch</Text>
      <Text>Profile: none</Text>
      <Text>Model: {selected.modelPath}</Text>
      <Text>Size: {modelSize(selected)} · compatibility and memory class unknown</Text>
      <Text>Context: <Text color="cyan">{resolved.preset.label}</Text> selected · 4K conservative default · trained limit unknown</Text>
      <Text>Defaults: batch/ubatch {resolved.batch.toLocaleString()}/{resolved.ubatch.toLocaleString()} · KV {resolved.kvType} · slots {resolved.slots}</Text>
      <Text>Projector: {genericValue('mmproj')} · Speculation: {resolved.speculationType}</Text>
      {resolved.speculationType !== 'none' && <Text>Draft/MTP: {genericValue('draft_model')} · depth {resolved.draftDepth} · p_min {resolved.pMin}</Text>}
      <Text>Endpoint: http://127.0.0.1:{serverSettings.port}/v1 · auth {serverSettings.auth.mode === 'file' ? 'bearer' : 'off'}</Text>
      {selected.issues.map(issue => <Text key={issue} color="red">• {issue}</Text>)}
      {resolved.warnings.map(warning => <Text key={warning} color="yellow">• {warning}</Text>)}
      <Box marginTop={1}><Text><Key>←/→</Key> context  <Key>e</Key> configure  <Key>p</Key> preview  <Key>s</Key> start  <Key>b</Key> back</Text></Box>
    </Box>)}
    {view === 'expert' && selected && resolved && <Box flexDirection="column"><Text bold color="cyan">{selected.profile.model.name} · Expert options  <Text color={runtimeColor(resolved)}>{resolved.runtimeLabel.toUpperCase()}</Text></Text>{expertFields.map((field, index) => <Text key={field} {...(index === expertIndex ? {color: 'cyan' as const} : {})}>{index === expertIndex ? '›' : ' '} {field.replaceAll('_', ' ').padEnd(22)} {expertValue(field)}</Text>)}<Text dimColor>Ubatch                  Auto → {resolved.ubatch.toLocaleString()} · locked</Text>{resolved.deltas.length > 0 && <Box flexDirection="column" marginTop={1}><Text bold>Custom deltas</Text>{resolved.deltas.map(delta => <Text key={delta}>• {delta}</Text>)}</Box>}{resolved.warnings.map(warning => <Text key={warning} color="yellow">• {warning}</Text>)}{resolved.rejection && <Text color="red">REJECTED: {resolved.rejection}</Text>}<Box marginTop={1}><Text><Key>↑/↓</Key> select  <Key>←/→</Key> change  <Key>r</Key> reset  <Key>p</Key> preview  <Key>s</Key> start  <Key>b</Key> back</Text></Box></Box>}
    {view === 'generic' && selected?.kind === 'unprofiled' && resolved && <Box flexDirection="column">
      <Text bold color="cyan">{selected.profile.model.name} · Generic Model Configuration  <Text color="yellow">UNPROFILED</Text></Text>
      <Text dimColor>Detected artifacts are defaults. Arrow keys choose presets; Enter edits numeric, path, template, and raw fields.</Text>
      {genericFields.map((field, index) => <Text key={field} wrap="truncate-end" {...(index === genericIndex ? {color: 'cyan' as const} : {})}>{index === genericIndex ? '›' : ' '} {genericLabel(field).padEnd(22)} {genericValue(field)}</Text>)}
      {genericInput && <Text>Edit {genericLabel(genericInput.field)}: <Text color="cyan">{genericInput.value}</Text><Text inverse> </Text></Text>}
      {genericMessage && <Text color="yellow">{genericMessage}</Text>}
      <Text dimColor>Loopback host, port/auth ownership, and disabled web/agent surfaces remain enforced.</Text>
      <Box marginTop={1}><Text><Key>↑/↓</Key> select  <Key>←/→</Key> preset  <Key>enter</Key> edit  <Key>r</Key> defaults  <Key>p</Key> preview  <Key>s</Key> start  <Key>b</Key> back</Text></Box>
    </Box>}
    {view === 'preview' && selected && resolved && <Box flexDirection="column">
      <Text bold>Effective configuration · <Text color={runtimeColor(resolved)}>{resolved.runtimeLabel.toUpperCase()}</Text></Text>
      {selected.kind === 'profiled' ? <Text>Profile: {selected.profile.profile_id}</Text> : <Text>Mode: Generic GGUF · no Tess verification claim</Text>}
      <Text>Context: {resolved.context.toLocaleString()} · batch/ubatch {resolved.batch}/{resolved.ubatch} · KV {resolved.kvType}</Text>
      {selected.kind === 'unprofiled' && <Text>GPU layers: {resolved.gpuLayers} · FA {resolved.flashAttention} · slots {resolved.slots} · mmap {resolved.mmap ? 'on' : 'off'} · mlock {resolved.mlock ? 'on' : 'off'}</Text>}
      {selected.kind === 'unprofiled' && <Text>Jinja: {resolved.jinja ? 'on' : 'off'} · template {resolved.chatTemplate || 'auto'} · reasoning {resolved.genericReasoning}/{resolved.reasoningFormat} · budget {resolved.reasoningBudget}</Text>}
      {selected.kind === 'unprofiled' && <Text>Projector: {resolved.mmproj ? basename(resolved.mmproj) : 'none'} · speculation {resolved.speculationType} · draft {resolved.draftModel ? basename(resolved.draftModel) : 'none/embedded'}</Text>}
      {resolved.speculation && <Text>Speculation: {resolved.speculation}{resolved.speculation === 'dspark' ? ` · depth ${resolved.draftDepth} · p_min ${resolved.pMin}` : ''}</Text>}
      {resolved.reasoning && <Text>Reasoning: {resolved.reasoning} · preserve {resolved.preserveReasoning ? 'on' : 'off'}</Text>}
      <Text>Endpoint: http://127.0.0.1:{serverSettings.port}/v1 · model {serverSettings.alias} · auth {serverSettings.auth.mode === 'file' ? 'bearer' : 'off'}</Text>
      {selected.kind === 'unprofiled' && <Box flexDirection="column" marginTop={1}><Text bold>Effective engine command</Text><Text wrap="wrap">{genericCommand}</Text></Box>}
      {resolved.deltas.map(delta => <Text key={delta}>Delta: {delta}</Text>)}
      {resolved.warnings.map(warning => <Text key={warning} color="yellow">• {warning}</Text>)}
      {resolved.rejection && <Text color="red">Start blocked: {resolved.rejection}</Text>}
      <Box marginTop={1}><Text><Key>s</Key> start  <Key>b</Key> back</Text></Box>
    </Box>}
    {view === 'process' && <Box flexDirection="column"><Text bold>{processMode === 'serve' ? 'Server' : 'Verification'} · {runningLabel.toUpperCase()} · <Text color={processStatus === 'failed' ? 'red' : processStatus === 'ready' ? 'green' : 'yellow'}>{processStatus}</Text></Text>{processMode === 'serve' && <Text>Health: {health} · http://127.0.0.1:{serverSettings.port}/v1 · auth {serverSettings.auth.mode === 'file' ? 'bearer' : 'off'}</Text>}{processExit && <Text {...(processStatus === 'failed' ? {color: 'red' as const} : {})}>{processExit}</Text>}<Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginTop={1}>{logs.length > 0 ? logs.map((line, index) => <Text key={`${index}:${line}`} wrap="truncate-end">{line}</Text>) : <Text dimColor>Waiting for output…</Text>}</Box><Box marginTop={1}><Text>{processStatus === 'exited' || processStatus === 'failed' ? <><Key>enter</Key> back</> : <><Key>q</Key> stop</>}</Text></Box></Box>}
  </Box>;
}
