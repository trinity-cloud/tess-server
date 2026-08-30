# Running Tess Server

## Install

Tess Server requires an Apple Silicon Mac and Node.js 22 or newer. GGUF profiles require macOS 15 or newer; Tess MLX currently requires macOS 26.2 or newer.

```bash
npm install -g @trinity-cloud/tess-server
tess-server doctor
tess-server
```

`doctor` verifies that the installed package and bundled engine payloads are usable on the current machine. No Homebrew, system Python, OpenSSL installation, Apple Developer membership, or separate engine installation is required.

Model weights are not included. Tess Server downloads a curated model only after
you select **Download** and confirm its repository, immutable revision, license,
size, and destination.

## Model library and runtime lanes

The TUI opens on **Tess MLX** and **GGUF** lanes. Each lane has a small
hardware-aware Recommended catalog and a persistent My Models section. Switch
lanes with `tab` or the left/right arrows. Press `b` for the native macOS
file/folder chooser, or `a` to enter a path manually.

Tess Server also scans common model folders on internal and attached storage.
Add search roots when invoking it if needed:

```bash
tess-server --model-root /Volumes/Models --model-root /path/to/another/folder
```

Press `r` to rescan. A recognized or structurally complete model is **Ready**;
an arbitrary local GGUF is **Local**; missing or incompatible artifacts are
**Needs attention**. Selecting a ready model and pressing `enter` launches it.
Press `i` for details.

Tess MLX checkpoints are discovered by their `model.safetensors.index.json`
file and shown as one model-directory entry. They execute the bundled Tess MLX
server directly; no Python runtime, extraction step, or network access is used.
Normal model discovery and launch inspect structure and byte lengths without a
whole-model hash pass.

## Choose a context

Press `i` on a model and then `x` to open Advanced. Context remains the first
choice; left/right changes the selected value.

The TUI marks the recommended default, experimental choices, and untested or
qualification-pending choices for profiled models. Every configured context
choice remains selectable; an untested choice displays a warning and carries no
compatibility, memory, correctness, quality, or performance claim. Memory-sensitive
values are managed automatically and shown in the effective configuration preview.

For a local GGUF model, Advanced starts from conservative settings. It
starts with a 4K context, 512 batch/ubatch, F16 K/V cache, all GPU layers,
automatic Flash Attention, one slot, mmap and Jinja enabled, and mlock disabled.
Nearby projector and draft/MTP files with strong filename matches are selected
automatically. Common values are available with the arrow keys; press `enter` to
type an exact numeric value, file path, chat template, or additional engine
arguments. Press `r` to restore detected defaults.

The screen exposes context, batch/ubatch, independent K/V types, GPU layers,
Flash Attention, slots, mmap/mlock, Jinja/chat template, reasoning behavior,
projector, speculation type, draft/MTP model, draft depth, and acceptance
threshold. Less common llama-server flags may be entered under **extra args**;
networking, authentication, model paths, and first-class settings remain owned by
the TUI. Press `p` to inspect the complete effective engine command before start.

The TUI does not know an arbitrary model's trained context or memory envelope.
All unprofiled selections are best-effort regardless of the chosen values.

If a model requires a larger GPU-wired memory limit, the details screen prints the exact one-time-per-boot command. Run it separately in another terminal, then relaunch Tess Server.

## Configure the server

Press `,` on the model library to configure shared server settings:

- **Port** — `8787` by default.
- **API model name** — `local-llama-server` by default.
- **Authentication** — off or file-backed bearer authentication.

Managed TUI launches always bind to `127.0.0.1`. LAN binds, arbitrary response headers, CORS configuration, and TLS termination are outside the managed surface.

For bearer authentication, create a private file containing at least 32 non-whitespace characters and restrict it to your user:

```bash
chmod 600 /path/to/tess-server.key
```

Enter that path in Configure Server. The key value is not copied into TUI settings or printed in logs. Clients send it through the conventional `Authorization: Bearer <token>` header.

## Inspect, launch, and follow progress

Normal launch checks required paths, sizes, index/config metadata, shard
coverage, and engine compatibility without computing model digests. The
scriptable `tess-server inspect` command performs the same non-loading
structural preflight. `tess-server doctor` is the separate explicit command
that verifies the bounded installed engine payload cryptographically.

The server dashboard reports Inspecting model, Opening weights, Loading weights,
Preparing runtime, Starting API, and Ready. A quiet but live process is shown as
Still working with the last successful phase. Press `l` to reveal bounded raw
logs and `q` to stop the server cleanly.

The default endpoint is:

```text
http://127.0.0.1:8787/v1
```

## OpenAI-compatible API

Tess Server supports streaming and non-streaming chat completions and tool calls.

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "local-llama-server",
    "messages": [{"role": "user", "content": "Write a hello-world function in Swift."}],
    "stream": false
  }'
```

Useful local endpoints include `/health`, `/v1/models`, `/v1/chat/completions`,
`/v1/tess/capabilities`, `/props`, `/slots`, and `/metrics`. The capability
record is authoritative for the active model's context and output-token budget.

## Scriptable commands

```bash
tess-server profiles
tess-server profiles --json
tess-server models --model-root /Volumes/Models
tess-server inspect --profile PROFILE_ID --model /path/to/model-or-mlx-directory
tess-server serve --profile PROFILE_ID --model /path/to/model-or-mlx-directory --context 32768 --port 8787
tess-server doctor
tess-server doctor --json
tess-server engine -- --help
```

Use `tess-server profiles` to obtain current profile IDs. A model that requires multiple shards or a companion file must be complete before `inspect` or `serve` succeeds.

Direct engine invocation is an expert escape hatch. It does not carry the safety or qualification claim of a packaged profile.

## Client context settings

Two rules keep long-running sessions away from the hard context wall:

1. Read the active runtime capability record instead of assuming every model
   behind `local-llama-server` has the same context.
2. Clamp requested output tokens to the prompt-aware remaining budget.
3. Set the client's compaction threshold comfortably below that context.

Reaching the hard context limit can interrupt a response or structured tool call. Tess Server does not silently enlarge the selected window.

## Privacy defaults

- Loopback-only managed TUI endpoints.
- No telemetry, cloud fallback, update checks, or implicit model downloads.
- No prompt or generation logging by Tess Server.
- Browser UI and built-in agent/tool surfaces disabled for managed TUI launches.
- Optional bearer authentication backed by a local file.

## Thermal guidance

Sustained inference can reduce performance as the Mac heats. Keep airflow unobstructed and avoid running another GPU-heavy workload beside the server when measuring throughput or serving the largest profiles.
