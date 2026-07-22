# Tess Server

```text
    ╷ ╷ ╷ ╷ ╷ ╷
  ┌─┴─┴─┴─┴─┴─┴─┐
 ─┤             ├─
 ─┤   T E S S   ├─
 ─┤ S E R V E R ├─
 ─┤             ├─
  └─┬─┬─┬─┬─┬─┬─┘
    ╵ ╵ ╵ ╵ ╵ ╵
```

**Run frontier-scale open models locally on Apple Silicon.**

Tess Server is a guided terminal application for discovering, configuring, verifying, and serving large GGUF models on your Mac. It combines an open-source TypeScript/Ink interface with the proprietary Tess Server engine and exposes an OpenAI-compatible API for Tess and other local clients.

Your models and prompts stay on your machine. Tess Server does not download weights, send telemetry, check for updates, or fall back to a cloud service.

## Quick start

```bash
npm install -g @trinity-cloud/tess-server
tess-server doctor
tess-server
```

The TUI searches common model folders on internal and attached storage. Select a supported model, choose a context window, verify the files, and press `s` to start the server.

The Silicon chip is Tess Server's primary mark. The TUI switches to a compact
wordmark on deeper screens to preserve working space.

Model weights are not bundled. You must obtain and store GGUF files under their respective licenses.

## What Tess Server handles

- Discovers supported models under `~/models`, `~/Models`, and `models` or `Models` folders on attached volumes.
- Lets you add any other model folder from the TUI or with `--model-root`.
- Matches local files to versioned Tess profiles and verifies them before the first profile launch.
- Offers profile-qualified context windows and clearly labels experimental or qualification-pending choices.
- Manages resource settings that should not be changed casually.
- Starts and monitors a loopback-only OpenAI-compatible server.
- Performs clean shutdown from the dashboard so the engine is not left running in the background.

## Supported profiles

The current release candidate includes five profiles:

| Model | Quantization | GGUF size | Memory class | Default context | Available context choices |
|---|---|---:|---:|---:|---|
| **Tess-4-35B-A3B** (Qwen3.6-35B-A3B base) | Tess Q8/Q4 build | 35.2 GiB | 64 GiB | 128K | 32K, 64K, 128K, 256K; 512K and 1M pending |
| **NVIDIA Nemotron-3-Super-120B-A12B** | UD-Q4_K_M | 76.9 GiB | 128 GiB | 32K | 32K, 64K, 128K, 256K; experimental 512K and 1M |
| **DeepSeek-V4-Flash** | UD-IQ3_XXS | 95.9 GiB | 128 GiB | 32K | 4K, 8K, 16K, 32K, 64K, 128K, 256K; 512K and 1M pending |
| **MiniMax-M2.7** | UD-IQ4_XS | 101 GiB | 128 GiB | 70K | 32K, 64K, 70K, 96K, 128K, 160K, 192K |
| **Tencent Hy3** | IQ2_M | 93.1 GiB | 128 GiB | 32K | 8K, 16K, 32K, 48K; experimental 64K |

Profile support is exact-file specific. Generic GGUF files can still be passed directly to the engine, but they do not carry a verified-profile claim.

See [Supported models](docs/models.md) for context and memory guidance.

## Release-qualified performance

The following results come from the packaged release candidate on one Apple M4 Max with 128 GiB unified memory. Every model ran alone with an exact 24,576-token prompt, 1,024 generated tokens, temperature zero, and prompt caching disabled.

| Model | Prefill | Decode |
|---|---:|---:|
| **Tess-4 / Qwen3.6-35B-A3B** | **1,286.32 tok/s** | **102.31 tok/s** |
| **NVIDIA Nemotron-3-Super** | **379.03 tok/s** | **27.62 tok/s** |
| **DeepSeek-V4-Flash** | **245.91 tok/s** | **29.16 tok/s** |
| **MiniMax-M2.7** | **252.26 tok/s** | **21.28 tok/s** |
| **Tencent Hy3** | **145.37 tok/s** | **18.84 tok/s** |

These are sustained release-qualification measurements under one common protocol, not cherry-picked peaks or stock-runtime comparisons. Throughput varies with context depth, prompt shape, output, temperature, memory pressure, and cooling.

See [Performance and methodology](docs/performance.md) for the protocol, memory observations, and claim scope.

## Configure the server

Press `c` on the model list to configure:

- **Port** — defaults to `8787`.
- **API model name** — defaults to `local-llama-server`.
- **Authentication** — off by default, or bearer authentication backed by a private local key file.

Verified profile launches bind to `127.0.0.1`. Tess Server does not expose them to your LAN.

Press `e` on model details for that profile's expert options. The TUI distinguishes ordinary choices from experimental tiers and blocks configurations that are not available in the packaged profile.

## Connect a client

The default endpoint is:

```text
http://127.0.0.1:8787/v1
```

For example:

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "local-llama-server",
    "messages": [{"role": "user", "content": "Hello from my Mac"}]
  }'
```

Streaming, tool calls, and standard chat completions are supported. If bearer authentication is enabled, add the conventional `Authorization: Bearer ...` header.

## Privacy and security

Verified profile launches provide the following defaults:

- Loopback-only networking.
- No telemetry, update checks, cloud fallback, or implicit downloads.
- No prompt or generation logging by Tess Server.
- Browser UI and built-in agent/tool surfaces disabled.
- Optional file-backed bearer authentication without storing the key value in TUI settings.
- Model-file verification before a profile is labeled verified.

Tess Server is an inference server, not a security boundary for untrusted model files or untrusted local users. Only load models you trust and have the right to use.

## Requirements

- Apple Silicon Mac (`arm64`).
- macOS 15 or newer by deployment target. The current packaged qualification host is macOS 26.2; macOS 15.x remains compatibility-targeted until tested on a physical Sequoia installation.
- Node.js 22 or newer.
- Sufficient unified memory for the selected profile.
- Locally stored GGUF weights.

Some 128 GiB profiles require a larger macOS GPU-wired memory limit. When needed, the TUI prints the exact one-time-per-boot command. Tess Server never runs that command, requests administrator privileges, or changes the limit itself.

## Command-line use

The interactive TUI is the recommended entry point. Scriptable commands are also available:

```bash
tess-server profiles
tess-server models --model-root /Volumes/Models
tess-server verify --profile PROFILE_ID --model /path/to/model.gguf
tess-server serve --profile PROFILE_ID --model /path/to/model.gguf --context 32768
tess-server doctor
tess-server engine -- --help
```

See [Running Tess Server](docs/running.md) for complete examples and client guidance.

## Licensing

This repository has a deliberate split-license boundary:

- The TypeScript/Ink TUI and npm tooling are open source under the [MIT License](LICENSE-TUI.md).
- The bundled Tess Server engine sidecar is governed by the [Tess Server Engine License Agreement](LICENSE.md).
- Third-party components retain their original licenses, listed in [Third-party notices](THIRD_PARTY_NOTICES.md).
- Model weights are not included and remain governed by their own licenses.

Tess Server is built on the MIT-licensed [llama.cpp](https://github.com/ggml-org/llama.cpp) and ggml foundations. Trinity Cloud's proprietary engine modifications are not part of the open-source TUI license.

## Documentation

- [Documentation index](docs/index.md)
- [Supported models](docs/models.md)
- [Running Tess Server](docs/running.md)
- [Performance and methodology](docs/performance.md)
- [Brand marks](docs/branding.md)

---

Built by [Trinity Cloud, Inc.](https://trinitycloud.ai).
