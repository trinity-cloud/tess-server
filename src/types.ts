export interface ProfileEngine {
  min_version: string;
  max_version: string | null;
}

export interface ProfileModel {
  name: string;
  architecture: string;
  quant_label: string;
  total_params: string;
  active_params: string | null;
}

export interface ProfileShard {
  name: string;
  bytes: number;
  sha256: string;
}

export interface ProfileContext {
  trained: number;
  engine_allocatable: number;
  validated: number;
  default: number;
  qualified?: number;
  validated_prompt?: number;
  validated_generation?: number;
}

export type PresetAvailability = 'available' | 'qualification-pending';

export interface ProfileContextPreset {
  tokens: number;
  label: string;
  group?: string;
  recommended?: boolean;
  experimental?: boolean;
  availability?: PresetAvailability;
  unavailable_reason?: string;
  ubatch: number;
  batch?: number;
  requires_wired_limit_mb?: number;
  speculation?: 'profile' | 'off';
  rope?: {
    type: 'yarn';
    factor: number;
    original_context: number;
  };
}

export interface ProfileChoiceOption {
  id: string;
  label: string;
  launcher_value: string;
  availability?: PresetAvailability;
  unavailable_reason?: string;
  max_context?: number;
}

export interface ProfileExpert {
  context_presets: ProfileContextPreset[];
  speculation?: {
    default: 'dspark' | 'off';
    options: Array<'dspark' | 'off'>;
    draft_depth_default: number;
    draft_depth_min: number;
    draft_depth_max: number;
    p_min_default: number;
    p_min_presets: number[];
  };
  reasoning?: {
    default: 'full' | 'low' | 'off';
    options: Array<'full' | 'low' | 'off'>;
    preserve_default: boolean;
  };
  kv_quality?: {
    default: string;
    options: ProfileChoiceOption[];
  };
}

export interface ProfileRuntime {
  batch: number;
  ubatch: number;
  kv_type: string;
  slots: number;
  flash_attention: boolean;
  jinja: boolean;
  env?: Record<string, string | number>;
}

export interface ProfileSpeculation {
  type: string;
  n_max: number;
  p_min: number;
  invariants: string[];
}

export interface ProfileMemory {
  ram_class_gib: number;
  wired_limit_note: string | null;
  requires_wired_limit_mb?: number;
}

export interface ProfileDescriptor {
  profile_id: string;
  schema_version: number;
  engine: ProfileEngine;
  model: ProfileModel;
  shards: ProfileShard[];
  draft: ProfileShard[] | null;
  context: ProfileContext;
  runtime: ProfileRuntime;
  speculation: ProfileSpeculation | null;
  memory: ProfileMemory;
  evidence: string[];
  limitations: string[];
  expert: ProfileExpert;
}

export interface ModelCandidate {
  kind: 'profiled' | 'unprofiled';
  profile: ProfileDescriptor;
  modelPath: string;
  draftPath?: string;
  companions?: {
    mmproj: string[];
    draft: string[];
    recommendedMmproj?: string;
    recommendedDraft?: string;
    recommendedSpeculation?: GenericSpeculationType;
  };
  complete: boolean;
  issues: string[];
}

export type GenericKvType = 'f32' | 'f16' | 'bf16' | 'q8_0' | 'q4_0' | 'q4_1' | 'iq4_nl' | 'q5_0' | 'q5_1';
export type GenericFlashAttention = 'auto' | 'on' | 'off';
export type GenericReasoning = 'auto' | 'on' | 'off';
export type GenericReasoningFormat = 'auto' | 'none' | 'deepseek' | 'deepseek-legacy';
export type GenericTriState = 'auto' | 'on' | 'off';
export type GenericSpeculationType = 'none' | 'draft-simple' | 'draft-eagle3' | 'draft-mtp' | 'draft-dflash';

export interface LaunchOverrides {
  context?: number;
  batch?: number;
  ubatch?: number;
  cacheTypeK?: GenericKvType;
  cacheTypeV?: GenericKvType;
  gpuLayers?: string;
  flashAttention?: GenericFlashAttention;
  slots?: number;
  mmap?: boolean;
  mlock?: boolean;
  jinja?: boolean;
  chatTemplate?: string;
  genericReasoning?: GenericReasoning;
  reasoningFormat?: GenericReasoningFormat;
  reasoningBudget?: number;
  reasoningPreserve?: GenericTriState;
  mmproj?: string;
  speculationType?: GenericSpeculationType;
  draftModel?: string;
  rawEngineArgs?: string;
  port?: number;
  alias?: string;
  apiKeyFile?: string;
  speculation?: 'dspark' | 'off';
  draftDepth?: number;
  pMin?: number;
  reasoning?: 'full' | 'low' | 'off';
  preserveReasoning?: boolean;
  kvQuality?: string;
  printConfig?: boolean;
}

export type RuntimeLabel = 'verified' | 'custom' | 'unprofiled' | 'rejected';

export interface ResolvedProfileConfiguration {
  profileId: string;
  context: number;
  preset: ProfileContextPreset;
  batch: number;
  ubatch: number;
  speculation?: 'dspark' | 'off';
  draftDepth?: number;
  pMin?: number;
  reasoning?: 'full' | 'low' | 'off';
  preserveReasoning?: boolean;
  kvQuality?: string;
  kvType: string;
  cacheTypeK?: GenericKvType;
  cacheTypeV?: GenericKvType;
  gpuLayers?: string;
  flashAttention?: GenericFlashAttention;
  slots?: number;
  mmap?: boolean;
  mlock?: boolean;
  jinja?: boolean;
  chatTemplate?: string;
  genericReasoning?: GenericReasoning;
  reasoningFormat?: GenericReasoningFormat;
  reasoningBudget?: number;
  reasoningPreserve?: GenericTriState;
  mmproj?: string;
  speculationType?: GenericSpeculationType;
  draftModel?: string;
  rawEngineArgs?: string;
  extraArgs?: string[];
  runtimeLabel: RuntimeLabel;
  deltas: string[];
  warnings: string[];
  startable: boolean;
  rejection?: string;
}

export interface ServerSettings {
  schema_version: 1;
  port: number;
  alias: string;
  auth: {
    mode: 'off' | 'file';
    key_file?: string;
  };
}

export interface ProcessSpec {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}
