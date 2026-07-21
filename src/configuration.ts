import type {LaunchOverrides, ProfileChoiceOption, ProfileDescriptor, ResolvedProfileConfiguration} from './types.js';

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
  let startable = preset.availability !== 'qualification-pending';
  let rejection = startable ? undefined : preset.unavailable_reason ?? `${preset.label} is qualification-pending`;

  if (context !== profile.context.default) {
    deltas.push(`context=${context} (verified ${profile.context.default})`);
  }
  if (preset.experimental) {
    warnings.push(`${preset.label} is experimental and does not inherit verified-default performance claims.`);
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
