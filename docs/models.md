# Supported models

Tess Server profiles match specific model artifacts to tested operating envelopes. A matching profile gives the TUI enough information to identify the required files, offer supported context choices, manage memory-sensitive settings, and label the resulting launch accurately.

Model weights are not included and Tess Server does not download them. You are responsible for obtaining the files lawfully and following each model's license.

## Current release profiles

| Model | Quantization | GGUF size | Memory class | Default | Context choices |
|---|---|---:|---:|---:|---|
| **Laguna S.2** | Q4_K_M + BF16 DFlash | 70.0 GiB + 2.1 GiB draft | 128 GiB | 16K | 8K, 16K; experimental 32K; 64K, 128K, and 256K qualification pending |
| **Tess-4-35B-A3B** (Qwen3.6-35B-A3B base) | Tess Q8/Q4 build | 35.2 GiB | 64 GiB | 128K | 32K, 64K, 128K, 256K; 512K and 1M qualification pending |
| **NVIDIA Nemotron-3-Super-120B-A12B** | UD-Q4_K_M | 76.9 GiB | 128 GiB | 32K | 32K, 64K, 128K, 256K; experimental 512K and 1M |
| **DeepSeek-V4-Flash** | UD-IQ3_XXS | 95.9 GiB | 128 GiB | 32K | 4K, 8K, 16K, 32K, 64K, 128K, 256K; 512K and 1M qualification pending |
| **MiniMax-M2.7** | UD-IQ4_XS | 101 GiB | 128 GiB | 70K | 32K, 64K, 70K, 96K, 128K, 160K, 192K |
| **Tencent Hy3** | IQ2_M | 93.1 GiB | 128 GiB | 32K | 8K, 16K, 32K, 48K; experimental 64K |

Memory class describes the qualified hardware tier, not a promise that the model consumes the full amount at every context.

## Profile labels

- **Verified** — the packaged engine, model files, profile, and selected settings match a qualified combination.
- **Custom** — a recognized profile is running with an operator-selected deviation from its qualified defaults.
- **Unprofiled / best effort** — the TUI found a primary GGUF that does not match a packaged profile and launched it with conservative generic settings.
- **Experimental** — the choice is available for testing but is not part of the profile's ordinary qualification claim.
- **Qualification pending** — the choice is visible but cannot be started through the public profile until its release gates close.

## Model discovery

The TUI searches:

- `~/models`
- `~/Models`
- `models` and `Models` directories on attached volumes
- Any folder added with `a` in the TUI
- Any repeatable `--model-root PATH` supplied on the command line

Multi-file models must keep all required shards together. If a profile requires an additional companion file, it must also be present. The TUI reports missing files before launch.

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

Larger context choices increase memory use and can reduce decode speed. The TUI manages sensitive resource settings for each choice and clearly labels experimental tiers.
