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
  profile: ProfileDescriptor;
  modelPath: string;
  draftPath?: string;
  complete: boolean;
  issues: string[];
}

export interface LaunchOverrides {
  context?: number;
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

export type RuntimeLabel = 'verified' | 'custom' | 'rejected';

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
