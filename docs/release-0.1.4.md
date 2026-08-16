# Tess Server 0.1.4

Status: stable release (August 16, 2026).

Tess Server 0.1.4 expands the exact-file profile catalog from six to ten models:

| Added profile | Verified default | Qualification boundary |
|---|---:|---|
| Qwen3.5-122B-A10B Q4_K_M | 16K | Target-only through 16K |
| Inkling-Small UD-IQ3_XXS | 16K | Target-only through 16K |
| Muse Glimmer 30B K-Quant + DFlash | 16K | DFlash `n_max=3`, `p_min=0.7` through 16K |
| DeepSeek-V4-Flash-0731 UD-IQ3_XXS + DSpark | 8K | DSpark at 4K/8K; target-only 16K-256K |

Larger configured contexts remain selectable. They receive a custom runtime label and an explicit warning that Tess Server makes no compatibility, memory, correctness, quality, or performance claim for that setting.

The Qwen3.5, Inkling-Small, and Muse Glimmer profiles are text-only in 0.1.4. Their broader multimodal capabilities are not included in the verified claim until projector and media-path qualification is complete.

## Release qualification

The 0.1.4 package was frozen after the following gates passed against one engine revision:

- Clean, isolated, reproducible arm64 release builds with matching executable and Metal library provenance.
- Exact model and companion SHA-256 verification for all four added profiles.
- Default-profile startup, deterministic generation, structured tool-call, cancellation, and recovery smokes.
- Speculative versus target-only token identity for Muse Glimmer and DeepSeek-V4-Flash-0731 at their packaged defaults.
- Regression smokes for the six retained 0.1.3 profiles.
- TUI tests, type checking, launcher syntax and policy tests, staging scans, sidecar verification, package dry run, and clean-prefix installation.

Performance claims for the four additions will be published only after a common release protocol is complete. Campaign measurements used to select safe defaults do not automatically become cross-model marketing comparisons.
