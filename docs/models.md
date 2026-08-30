# Supported models

Tess Server profiles match specific model artifacts to tested operating envelopes. A matching profile gives the TUI enough information to identify the required files, offer supported context choices, manage memory-sensitive settings, and label the resulting launch accurately.

Model weights are not included and Tess Server does not download them. You are responsible for obtaining the files lawfully and following each model's license.

## Current release profiles

| Model | Quantization | Model size | Memory class | Default | Context choices |
|---|---|---:|---:|---:|---|
| **Laguna S.2** | Q4_K_M + BF16 DFlash | 63.6 GiB + 2.1 GiB draft | 128 GiB | 16K | 8K, 16K, 32K, 64K, 128K, 256K |
| **Tess-4-35B-A3B** (Qwen3.6-35B-A3B base) | Tess Q8/Q4 build | 35.2 GiB | 64 GiB | 128K | 32K, 64K, 128K, 256K, 512K; untested 1M |
| **Qwen3.5-122B-A10B** | Q4_K_M | 71.3 GiB | 128 GiB | 16K | 8K, 16K; untested 32K, 64K, 128K, and 256K |
| **Inkling-Small** | UD-IQ3_XXS | 91.2 GiB | 128 GiB | 16K | 8K, 16K; untested 32K through 1M |
| **Muse Glimmer 30B** | K-Quant 17GB + DFlash | 15.6 GiB + 1.5 GiB draft | 64 GiB | 16K | 8K, 16K; untested 32K, 64K, and 128K |
| **NVIDIA Nemotron-3-Super-120B-A12B** | UD-Q4_K_M | 76.9 GiB | 128 GiB | 32K | 32K, 64K, 128K, 256K; experimental 512K and 1M |
| **DeepSeek-V4-Flash** | UD-IQ3_XXS + DSpark | 95.9 GiB + 10.5 GiB draft | 128 GiB | 32K | 4K, 8K, 16K, 32K, 64K, 128K, 256K; untested 512K and 1M |
| **DeepSeek-V4-Flash-0731** | UD-IQ3_XXS + DSpark | 95.9 GiB + 10.5 GiB draft | 128 GiB | 8K | 4K-256K with DSpark by default; untested 512K and 1M; DSpark can be disabled |
| **DeepSeek-V4-Flash-0731 MLX** | 2.4-bit mixed, Tess MLX target-only | 84.6 GiB | 128 GiB | 8K | Qualified 4K, 8K, 16K, and 32K |
| **MiniMax-M2.7** | UD-IQ4_XS | 101 GiB | 128 GiB | 70K | 32K, 64K, 70K, 96K, 128K, 160K, 192K |
| **Tencent Hy3** | IQ2_M | 93.1 GiB | 128 GiB | 32K | 8K, 16K, 32K, 48K; experimental 64K |

Memory class describes the qualified hardware tier, not a promise that the model consumes the full amount at every context.

The four 0.1.4 additions use intentionally narrow verified defaults. Qwen3.5-122B-A10B and Inkling-Small are qualified through 16K target-only serving. Muse Glimmer is qualified through 16K with its exact DFlash companion at the packaged short-round setting. DeepSeek-V4-Flash-0731 defaults to DSpark at every context and exposes a target-only opt-out. Its 4K/8K identity evidence remains the narrow verified DSpark claim; one 16K deterministic canary diverged from target-only output while retaining high acceptance and approximately 20% higher decode throughput. Every larger untested tier is labeled custom and warns that compatibility, memory, correctness, quality, and performance are unclaimed.

Qwen3.5-122B-A10B, Inkling-Small, and Muse Glimmer have multimodal model families, but their 0.1.4 verified profiles are text-only. Tess Server does not attach or claim a projector for these profiles until image and audio behavior passes separate qualification.

The DeepSeek profiles are exact-artifact-specific and intentionally coexist. `dsv4-dspark` identifies the original qualified GGUF set, `dsv4-0731-dspark` identifies the archived 0731 GGUF shards and matching DSpark draft, and `dsv4-0731-mlx-24mixed` identifies the 18-shard MLX checkpoint at Hugging Face revision `10001e0065f8394e03e968e652cbbe7cd2ca122c`. Different bytes do not inherit a verified label.

The MLX profile uses the bundled Tess MLX C++ server with checksum-bound MLX dynamic libraries and compiled Metal code. It contains no Python runtime and needs no separate Python installation. Its 4K–32K presets passed exact greedy-token gates on the qualified M4 Max. This first Tess MLX path is target-only; DSpark is not exposed or claimed. MLX and GGUF use different quantizers, so no cross-format token-identity claim is made.

The verified Laguna profile carries Poolside's current chat template and applies it automatically. Users only need the exact Q4_K_M target and BF16 DFlash GGUF files; the importance matrix and alternate quantizations are not runtime dependencies. The packaged template preserves Laguna's native reasoning and tagged tool-call protocol so OpenAI-compatible clients receive structured tool calls instead of raw markup.

Laguna's six native presets are qualified through the full 262,144-token trained window. The July 24 matrix used exact near-full prompts at every preset, generated 256 tokens, recovered all five facts placed near 10/30/50/70/90 percent of the prompt, returned a structured `Read` tool call without raw tagged markup, exercised prompt-cache reuse and cancellation recovery, and verified clean behavior immediately below and at the context wall. See [Laguna context qualification](laguna-context-qualification.md).

Tess-4's native MTP configuration is qualified through 262,144 tokens, and its
target-only YaRN factor-2 configuration is qualified at 524,288 tokens. Each
configuration class was tested at its longest selectable tier, which qualifies
the lower tiers using the same runtime policy. The 1M YaRN factor-4 choice remains
selectable but is explicitly untested. See
[Tess-4 context qualification](tess-4-context-qualification.md).

Every context choice in this table is selectable. Qualification status changes
the label and warning—not availability. An untested choice carries no
compatibility, memory, correctness, quality, or performance claim.

## Profile labels

- **Verified** — the packaged engine, model files, profile, and selected settings match a qualified combination.
- **Custom** — a recognized profile is running with an operator-selected deviation from its qualified defaults.
- **Unprofiled / best effort** — the TUI found a primary GGUF that does not match a packaged profile and launched it with conservative generic settings.
- **Experimental** — the choice is available for testing but is not part of the profile's ordinary qualification claim.
- **Untested / qualification pending** — the choice remains selectable, but the TUI warns that it carries no qualification claim.

## Model discovery

The TUI searches:

- `~/models`
- `~/Models`
- `models` and `Models` directories on attached volumes
- Any folder added with `a` in the TUI
- Any repeatable `--model-root PATH` supplied on the command line

Multi-file models must keep all required shards together. An MLX model must remain in one directory with its safetensors index, tokenizer metadata, and every indexed weight shard. If a profile requires an additional companion file, it must also be present. The TUI reports missing files before launch.

Discovery separates results into two sections:

- **Profiled Models** match an exact packaged filename and retain the existing
  verification and managed-profile workflow.
- **Unprofiled Models** are other primary GGUF files. Multimodal projectors, MTP
  models, and draft heads are associated with the primary model instead of being
  shown as invalid standalone entries. Strong filename matches are preselected;
  the configuration screen lets you disable or replace them.

An unprofiled launch starts from usable, conservative defaults: 4K context,
512 batch/ubatch, F16 K/V cache, all GPU layers, automatic Flash Attention, one
slot, mmap and Jinja enabled, mlock disabled, and model-metadata chat/reasoning
behavior. Exact companion matches are selected automatically with draft depth 3
and acceptance threshold 0. Arrow-key presets cover common values, and editable
fields accept model-specific values such as a 24K context.

The dedicated configuration screen exposes context, batch/ubatch, independent K/V
cache types, GPU layers, Flash Attention, slots, mmap/mlock, Jinja and chat
template, reasoning controls, multimodal projector, speculation type, draft/MTP
model, draft depth, and acceptance threshold. An additional engine-arguments field
is available for less common llama-server options. It cannot override networking,
authentication, model paths, or a first-class setting; the preview prints the
effective engine command before launch.

Tess Server cannot infer that an arbitrary model was trained for the selected
window or that the machine has enough memory. Unprofiled launches carry no
compatibility, verification, correctness, or performance claim.

## File verification

Before the first verified launch, Tess Server checks that the local files match the packaged profile. Replacing or modifying a model causes verification to run again. A mismatch is a startup error rather than a warning.

Unprofiled models do not expose the verification action because Tess Server has no
expected checksums or qualified configuration for them.

This verification identifies the expected artifact; it does not grant a model license or establish that an untrusted model is safe.

## GPU-wired memory

Some large profiles need more GPU-wired memory than macOS exposes by default. When required, Tess Server prints a command such as:

```bash
sudo sysctl iogpu.wired_limit_mb=129024
```

The change lasts until reboot. Tess Server never runs the command, invokes `sudo`, requests administrator access, or changes the setting automatically.

## Context discipline

The client context limit must not exceed the server window. For long-running agents, set the client's compaction threshold comfortably below the selected server context so the conversation is compacted before reaching the hard ceiling.

Larger context choices increase memory use and can reduce decode speed. The TUI manages sensitive resource settings for each configured choice and clearly labels experimental or untested tiers without blocking them.
