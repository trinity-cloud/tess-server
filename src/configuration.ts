import type {GenericFlashAttention, GenericKvType, GenericReasoning, GenericReasoningFormat, GenericSpeculationType, GenericTriState, LaunchOverrides, ModelCandidate, ProfileChoiceOption, ProfileDescriptor, ProfileContextPreset, ResolvedProfileConfiguration} from './types.js';

export const genericContextChoices = [4096, 8192, 16384, 32768, 65536, 131072] as const;
export const genericBatchChoices = [128, 256, 512, 1024, 2048] as const;
export const genericUbatchChoices = [128, 256, 512, 1024, 2048] as const;
export const genericKvChoices: readonly GenericKvType[] = ['f16', 'q8_0', 'q4_0', 'f32', 'bf16', 'q4_1', 'iq4_nl', 'q5_0', 'q5_1'];
export const genericGpuLayerChoices = ['all', 'auto', '0'] as const;
export const genericFlashAttentionChoices: readonly GenericFlashAttention[] = ['auto', 'on', 'off'];
export const genericSlotChoices = [1, 2, 4] as const;
export const genericReasoningChoices: readonly GenericReasoning[] = ['auto', 'on', 'off'];
export const genericReasoningFormatChoices: readonly GenericReasoningFormat[] = ['auto', 'none', 'deepseek', 'deepseek-legacy'];
export const genericTriStateChoices: readonly GenericTriState[] = ['auto', 'on', 'off'];
export const genericSpeculationChoices: readonly GenericSpeculationType[] = ['none', 'draft-mtp', 'draft-simple', 'draft-eagle3', 'draft-dflash'];
export const genericChatTemplateChoices = ['', 'chatml', 'deepseek', 'deepseek2', 'deepseek3', 'gemma', 'gpt-oss', 'llama3', 'llama4', 'mistral-v3', 'phi3', 'phi4', 'qwen2', 'vicuna', 'zephyr'] as const;

const reservedRawOptions = new Set([
  '-m', '--model', '-mu', '--model-url', '-dr', '--docker-repo', '-hf', '-hfr', '--hf-repo', '-hff', '--hf-file',
  '-c', '--ctx-size', '-b', '--batch-size', '-ub', '--ubatch-size', '-ctk', '--cache-type-k', '-ctv', '--cache-type-v',
  '-ngl', '--gpu-layers', '--n-gpu-layers', '-fa', '--flash-attn', '-np', '--parallel', '--mmap', '--no-mmap', '--mlock', '--jinja', '--no-jinja',
  '--chat-template', '--chat-template-file', '-rea', '--reasoning', '--reasoning-format', '--reasoning-budget', '--reasoning-preserve', '--no-reasoning-preserve',
  '-mm', '--mmproj', '-mmu', '--mmproj-url', '--mmproj-auto', '--no-mmproj', '--no-mmproj-auto', '--spec-type', '-md', '--model-draft', '--spec-draft-model',
  '--spec-draft-hf', '-hfd', '-hfrd', '--hf-repo-draft', '--spec-dspark',
  '--spec-draft-n-max', '--spec-draft-p-min', '--draft-p-min', '-a', '--alias', '--host', '--port', '--api-key', '--api-key-file',
  '--reuse-port', '--path', '--api-prefix', '--ssl-key-file', '--ssl-cert-file', '--media-path', '--props',
  '--ui', '--no-ui', '--webui', '--no-webui', '--ui-config', '--webui-config', '--ui-config-file', '--webui-config-file',
  '--ui-mcp-proxy', '--webui-mcp-proxy', '--no-ui-mcp-proxy', '--no-webui-mcp-proxy', '--tools', '-ag', '--agent', '-no-ag', '--no-agent',
  '--models-dir', '--models-preset', '--models-autoload', '--no-models-autoload', '--metrics', '--slots', '--no-slots',
]);

export function parseRawEngineArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: "'" | '"' | undefined;
  let escaping = false;
  const push = (): void => { if (current) { args.push(current); current = ''; } };
  for (const character of input.trim()) {
    if (escaping) { current += character; escaping = false; continue; }
    if (character === '\\' && quote !== "'") { escaping = true; continue; }
    if (quote) {
      if (character === quote) quote = undefined;
      else current += character;
      continue;
    }
    if (character === "'" || character === '"') { quote = character; continue; }
    if (/\s/.test(character)) push();
    else current += character;
  }
  if (escaping) throw new Error('extra engine arguments end with an incomplete escape');
  if (quote) throw new Error('extra engine arguments contain an unclosed quote');
  push();
  for (const argument of args) {
    const option = argument.split('=', 1)[0] ?? argument;
    if (reservedRawOptions.has(option)) throw new Error(`${option} is managed by a first-class Tess Server setting`);
  }
  return args;
}

function boundedInteger(name: string, value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be an integer from ${minimum.toLocaleString()} to ${maximum.toLocaleString()}`);
  return value;
}

function selectedOption(options: ProfileChoiceOption[], requested: string | undefined, fallback: string): ProfileChoiceOption {
  const id = requested ?? fallback;
  const option = options.find(candidate => candidate.id === id);
  if (!option) {
    throw new Error(`unsupported choice: ${id}`);
  }
  return option;
}

export function contextPreset(profile: ProfileDescriptor, context: number): ProfileDescriptor['expert']['context_presets'][number] {
  const preset = profile.expert.context_presets.find(candidate => candidate.tokens === context);
  if (!preset) {
    const choices = profile.expert.context_presets.map(candidate => candidate.tokens.toLocaleString()).join(', ');
    throw new Error(`context ${context.toLocaleString()} is not available for ${profile.model.name}; choose ${choices}`);
  }
  return preset;
}

export function resolveProfileConfiguration(profile: ProfileDescriptor, overrides: LaunchOverrides = {}): ResolvedProfileConfiguration {
  const context = overrides.context ?? profile.context.default;
  const preset = contextPreset(profile, context);
  const deltas: string[] = [];
  const warnings: string[] = [];
  let startable = true;
  let rejection: string | undefined;
  const qualificationPending = preset.availability === 'qualification-pending';

  const qualifiedCeiling = profile.context.qualified ?? profile.context.default;
  const qualifiedPreset = (
    !qualificationPending
    && !preset.experimental
    && context <= qualifiedCeiling
  );
  if (context !== profile.context.default && !qualifiedPreset) {
    deltas.push(`context=${context} (qualified ceiling ${qualifiedCeiling})`);
  }
  if (qualificationPending) {
    const reason = preset.unavailable_reason ?? `${preset.label} has not been qualified`;
    warnings.push(`${reason}. Launch is allowed, but compatibility, memory, correctness, quality, and performance are not claimed for this context.`);
  } else if (preset.experimental) {
    warnings.push(`${preset.label} is experimental and has not been qualified. Launch is allowed, but compatibility, memory, correctness, quality, and performance are not claimed for this context.`);
  } else if (context > qualifiedCeiling) {
    warnings.push(`${preset.label} exceeds the profile's qualified ${qualifiedCeiling.toLocaleString()}-token ceiling. Launch is allowed, but compatibility, memory, correctness, quality, and performance are not claimed for this context.`);
  }

  let speculation = profile.expert.speculation?.default;
  let draftDepth = profile.expert.speculation?.draft_depth_default;
  let pMin = profile.expert.speculation?.p_min_default;
  if (profile.expert.speculation) {
    const speculationConfig = profile.expert.speculation;
    const selectedSpeculation = overrides.speculation ?? speculationConfig.default;
    speculation = selectedSpeculation;
    if (!speculationConfig.options.includes(selectedSpeculation)) {
      throw new Error(`unsupported speculation mode: ${selectedSpeculation}`);
    }
    if (preset.speculation === 'off') {
      if (overrides.speculation === 'dspark') {
        startable = false;
        rejection = `${preset.label} is target-only in profile mode`;
      }
      speculation = 'off';
    }
    const selectedDepth = overrides.draftDepth ?? speculationConfig.draft_depth_default;
    const selectedPMin = overrides.pMin ?? speculationConfig.p_min_default;
    draftDepth = selectedDepth;
    pMin = selectedPMin;
    if (!Number.isInteger(selectedDepth) || selectedDepth < speculationConfig.draft_depth_min || selectedDepth > speculationConfig.draft_depth_max) {
      throw new Error(`draft depth must be ${speculationConfig.draft_depth_min}–${speculationConfig.draft_depth_max}`);
    }
    if (!Number.isFinite(selectedPMin) || selectedPMin < 0 || selectedPMin > 1) {
      throw new Error('p_min must be between 0 and 1');
    }
    if (selectedSpeculation !== speculationConfig.default) deltas.push(`speculation=${selectedSpeculation} (verified ${speculationConfig.default})`);
    if (selectedDepth !== speculationConfig.draft_depth_default) deltas.push(`draft_depth=${selectedDepth} (verified ${speculationConfig.draft_depth_default})`);
    if (selectedPMin !== speculationConfig.p_min_default) deltas.push(`p_min=${selectedPMin} (verified ${speculationConfig.p_min_default})`);
    if (selectedPMin < 0.5) warnings.push('p_min below 0.5 can underperform target-only decode on mixed traffic.');
  }

  let reasoning = profile.expert.reasoning?.default;
  let preserveReasoning = profile.expert.reasoning?.preserve_default;
  if (profile.expert.reasoning) {
    const reasoningConfig = profile.expert.reasoning;
    const selectedReasoning = overrides.reasoning ?? reasoningConfig.default;
    reasoning = selectedReasoning;
    if (!reasoningConfig.options.includes(selectedReasoning)) throw new Error(`unsupported reasoning mode: ${selectedReasoning}`);
    preserveReasoning = selectedReasoning === 'off' ? false : overrides.preserveReasoning ?? reasoningConfig.preserve_default;
    if (selectedReasoning !== reasoningConfig.default) deltas.push(`reasoning=${selectedReasoning} (verified ${reasoningConfig.default})`);
    if (preserveReasoning !== profile.expert.reasoning.preserve_default) deltas.push(`preserve_reasoning=${String(preserveReasoning)} (verified ${String(profile.expert.reasoning.preserve_default)})`);
    if (preserveReasoning) warnings.push('Preserving reasoning consumes context and changes later prompts.');
    if (preserveReasoning) {
      startable = false;
      rejection = 'reasoning-history preservation is qualification-pending';
    }
  }

  let kvQuality = profile.expert.kv_quality?.default;
  let kvType = profile.runtime.kv_type;
  if (profile.expert.kv_quality) {
    const option = selectedOption(profile.expert.kv_quality.options, overrides.kvQuality, profile.expert.kv_quality.default);
    kvQuality = option.id;
    kvType = option.launcher_value;
    if (option.max_context && context > option.max_context) {
      startable = false;
      rejection = `${option.label} is limited to ${option.max_context.toLocaleString()} tokens`;
    }
    if (option.availability === 'qualification-pending') {
      startable = false;
      rejection = option.unavailable_reason ?? `${option.label} is qualification-pending`;
    }
    if (option.id !== profile.expert.kv_quality.default) deltas.push(`kv_quality=${option.id} (verified ${profile.expert.kv_quality.default})`);
  }

  return {
    profileId: profile.profile_id,
    context,
    preset,
    batch: preset.batch ?? profile.runtime.batch,
    ubatch: preset.ubatch,
    ...(speculation ? {speculation} : {}),
    ...(draftDepth !== undefined ? {draftDepth} : {}),
    ...(pMin !== undefined ? {pMin} : {}),
    ...(reasoning ? {reasoning} : {}),
    ...(preserveReasoning !== undefined ? {preserveReasoning} : {}),
    ...(kvQuality ? {kvQuality} : {}),
    kvType,
    runtimeLabel: startable ? (deltas.length === 0 ? 'verified' : 'custom') : 'rejected',
    deltas,
    warnings,
    startable,
    ...(rejection ? {rejection} : {}),
  };
}

export function resolveUnprofiledConfiguration(candidate: ModelCandidate, overrides: LaunchOverrides = {}): ResolvedProfileConfiguration {
  if (candidate.kind !== 'unprofiled') throw new Error('generic configuration requires an unprofiled model');
  const profile = candidate.profile;
  const context = boundedInteger('context', overrides.context ?? 4096, 256, 4_194_304);
  const batch = boundedInteger('batch', overrides.batch ?? 512, 1, 8192);
  const ubatch = boundedInteger('ubatch', overrides.ubatch ?? Math.min(512, batch), 1, batch);
  const slots = boundedInteger('slots', overrides.slots ?? 1, 1, 64);
  const cacheTypeK = overrides.cacheTypeK ?? 'f16';
  const cacheTypeV = overrides.cacheTypeV ?? 'f16';
  if (!genericKvChoices.includes(cacheTypeK) || !genericKvChoices.includes(cacheTypeV)) throw new Error('unsupported generic KV cache type');
  const gpuLayers = overrides.gpuLayers ?? 'all';
  if (gpuLayers !== 'auto' && gpuLayers !== 'all' && (!/^\d+$/.test(gpuLayers) || Number(gpuLayers) > 999)) throw new Error('GPU layers must be auto, all, or an integer from 0 to 999');
  const flashAttention = overrides.flashAttention ?? 'auto';
  if (!genericFlashAttentionChoices.includes(flashAttention)) throw new Error('unsupported Flash Attention mode');
  const mmap = overrides.mmap ?? true;
  const mlock = overrides.mlock ?? false;
  const jinja = overrides.jinja ?? true;
  const chatTemplate = overrides.chatTemplate?.trim() ?? '';
  const genericReasoning = overrides.genericReasoning ?? 'auto';
  if (!genericReasoningChoices.includes(genericReasoning)) throw new Error('unsupported reasoning mode');
  const reasoningFormat = overrides.reasoningFormat ?? 'auto';
  if (!genericReasoningFormatChoices.includes(reasoningFormat)) throw new Error('unsupported reasoning format');
  const reasoningBudget = boundedInteger('reasoning budget', overrides.reasoningBudget ?? -1, -1, Number.MAX_SAFE_INTEGER);
  const reasoningPreserve = overrides.reasoningPreserve ?? 'auto';
  if (!genericTriStateChoices.includes(reasoningPreserve)) throw new Error('unsupported reasoning preservation mode');
  const mmproj = overrides.mmproj ?? candidate.companions?.recommendedMmproj ?? '';
  const draftModel = overrides.draftModel ?? candidate.companions?.recommendedDraft ?? '';
  const speculationType = overrides.speculationType ?? candidate.companions?.recommendedSpeculation ?? 'none';
  if (!genericSpeculationChoices.includes(speculationType)) throw new Error('unsupported speculation type');
  const draftDepth = boundedInteger('draft depth', overrides.draftDepth ?? 3, 1, 64);
  const pMin = overrides.pMin ?? 0;
  if (!Number.isFinite(pMin) || pMin < 0 || pMin > 1) throw new Error('acceptance threshold must be between 0 and 1');
  const rawEngineArgs = overrides.rawEngineArgs?.trim() ?? '';
  const extraArgs = parseRawEngineArgs(rawEngineArgs);
  const preset = profile.expert.context_presets.find(option => option.tokens === context) ?? ({tokens: context, label: context % 1024 === 0 ? `${context / 1024}K` : context.toLocaleString(), batch, ubatch} satisfies ProfileContextPreset);
  const deltas: string[] = [];
  if (context !== 4096) deltas.push(`context=${context} (generic default 4096)`);
  if (batch !== 512) deltas.push(`batch=${batch} (generic default 512)`);
  if (ubatch !== 512) deltas.push(`ubatch=${ubatch} (generic default 512)`);
  if (rawEngineArgs) deltas.push('additional engine arguments configured');
  const warnings = [
    'No Tess profile matches this file; compatibility, memory use, output quality, and performance are not qualified.',
    'The model training context is unknown. Increase context only if the model metadata and available memory support it.',
  ];
  if (ubatch > 512) warnings.push('Ubatch above 512 can sharply increase memory pressure on large models.');
  if (slots > 1) warnings.push('Multiple slots divide the context and increase memory use; one slot is the conservative default.');
  if (speculationType !== 'none' && !draftModel) warnings.push('Speculation is enabled without an external draft model; this only works when the primary GGUF carries a compatible embedded draft block.');
  return {
    profileId: profile.profile_id,
    context,
    preset,
    batch,
    ubatch,
    kvType: cacheTypeK === cacheTypeV ? cacheTypeK : `${cacheTypeK}/${cacheTypeV}`,
    cacheTypeK,
    cacheTypeV,
    gpuLayers,
    flashAttention,
    slots,
    mmap,
    mlock,
    jinja,
    chatTemplate,
    genericReasoning,
    reasoningFormat,
    reasoningBudget,
    reasoningPreserve,
    mmproj,
    speculationType,
    draftModel,
    draftDepth,
    pMin,
    rawEngineArgs,
    extraArgs,
    runtimeLabel: 'unprofiled',
    deltas,
    warnings,
    startable: true,
  };
}

export function launchOverridesFromResolved(resolved: ResolvedProfileConfiguration): LaunchOverrides {
  return {
    context: resolved.context,
    ...(resolved.speculation ? {speculation: resolved.speculation} : {}),
    ...(resolved.draftDepth !== undefined ? {draftDepth: resolved.draftDepth} : {}),
    ...(resolved.pMin !== undefined ? {pMin: resolved.pMin} : {}),
    ...(resolved.reasoning ? {reasoning: resolved.reasoning} : {}),
    ...(resolved.preserveReasoning !== undefined ? {preserveReasoning: resolved.preserveReasoning} : {}),
    ...(resolved.kvQuality ? {kvQuality: resolved.kvQuality} : {}),
  };
}
