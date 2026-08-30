# Tess Server documentation

Tess Server provides a guided terminal interface and a local OpenAI-compatible inference endpoint for supported GGUF models on Apple Silicon.

- [Supported models](models.md) — profiles, memory classes, context choices, and model-file expectations.
- [Tess Server 0.1.4](release-0.1.4.md) — added profiles and qualification boundaries.
- [Tess Server 0.1.5](release-0.1.5.md) — current-upstream DeepSeek-0731 serving and user-controllable DSpark at every context.
- [Tess Server 0.1.6](release-0.1.6.md) — Tess MLX serving for DeepSeek-V4-Flash-0731, initially target-only.
- [Running Tess Server](running.md) — installation, model discovery, server configuration, command-line operation, API access, and client context guidance.
- [Tess-4 context qualification](tess-4-context-qualification.md) — native 256K and YaRN 512K operational anchors.
- [Laguna context qualification](laguna-context-qualification.md) — full native 8K–256K qualification matrix.
- [Performance and methodology](performance.md) — common-protocol release results, measurement conditions, memory observations, and claim scope.
- [Brand system](branding.md) — the persistent Silicon product mark and secondary promotional artwork.
- [Licensing](../LICENSE) — the boundary between the MIT-licensed TUI, proprietary engine sidecar, third-party software, and separately licensed model weights.

**Current status:** stable release.
