# Tess Server 0.1.5

Tess Server 0.1.5 refreshes the packaged inference runtime so DeepSeek-V4-Flash-0731 uses the current upstream implementation and its exact upstream-compatible DSpark companion. The earlier Preview artifact generation remains on its compatible optimized engine, while the other verified profiles retain their qualified performance paths.

## DeepSeek and DSpark

Both exact DeepSeek-V4-Flash profiles now enable DSpark by default at every selectable context. Users can switch to target-only decoding from Expert options or with `--speculation off`.

The recorded 2K and 8K deterministic probes reproduced target-only tokens exactly and improved decode throughput by approximately 19-23%. One 16K deterministic canary produced a different greedy continuation with DSpark while maintaining high draft acceptance and approximately 20% higher decode throughput. The release therefore makes no general long-context token-identity claim for DSpark; the target-only opt-out remains available for users who require that behavior.

## Packaging

The proprietary sidecar remains checksum-bound and self-contained. Every packaged engine executable and compiled Metal library is covered by the release manifest, root checksum closure, provenance record, reproducible-build gate, and npm-sidecar verification. Model files and draft weights remain external and are never included in the npm package.
