# Tess-4 context qualification

Tess Server qualified Tess-4-35B-A3B through 524,288 tokens on July 24, 2026,
using the exact Tess Q8/Q4 profile build and the packaged engine.

Two runtime classes require separate anchors:

- Native RoPE with lossless MTP self-speculation, used by 32K, 64K, 128K, and
  256K. The longest 256K tier qualifies the lower native tiers.
- YaRN factor 2 with target-only decode, used by 512K.

Each anchor used a prompt ending 288 tokens below the configured window,
followed by 256 generated tokens. Five exact facts were placed near 10%, 30%,
50%, 70%, and 90% of the prompt. Both anchors also exercised structured tool
calling, prompt-cache reuse, prefill and decode cancellation recovery, a
one-token request immediately below the wall, a structured rejection at the
exact wall, a post-fill control request, memory sampling, model-file integrity,
and clean shutdown.

| Runtime class | Qualified choices | Anchor | Exact prompt | Recall | Tool call | Wall and recovery | Peak system wired | Result |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Native RoPE + MTP | 32K, 64K, 128K, 256K | 262,144 | 261,856 | PASS | PASS | PASS | 51.3 GiB | PASS |
| YaRN factor 2, target-only | 512K | 524,288 | 524,000 | PASS | PASS | PASS | 55.0 GiB | PASS |

The 512K anchor evaluated exactly 524,000 prompt tokens, generated 256 tokens
without truncation, and recovered cleanly after the context-wall checks. Peak
process RSS was 49.9 GiB and minimum reclaimable memory was 36.2 GiB on the
128 GiB qualification host with `iogpu.wired_limit_mb=129024`.

The selectable 1M choice uses YaRN factor 4 and has not been tested. Tess Server
does not block it, but displays an explicit warning and makes no compatibility,
memory, correctness, quality, or performance claim for that tier.

These runs are correctness and memory evidence, not public throughput claims.
The private evidence package retains exact token arrays, output hashes, memory
samples, server logs, package and launcher hashes, model signatures, and host
state. No model weights or user prompt data are included in this repository.
