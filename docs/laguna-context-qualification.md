# Laguna S.2 context qualification

Tess Server qualified every native Laguna S.2 context preset on July 24, 2026,
using the refreshed Q4_K_M target, its exact BF16 DFlash companion, and the
managed verified runtime policy.

Each row used a prompt ending 288 tokens below the configured window, followed
by 256 generated tokens. Five exact facts were placed near 10%, 30%, 50%, 70%,
and 90% of the prompt. Every row also exercised structured tool calling, prompt
cache reuse, prefill and decode cancellation recovery, a one-token request
immediately below the wall, a structured rejection at the exact wall, a
post-fill control request, memory sampling, file-integrity checks, and clean
shutdown.

| Context | Exact prompt | Recall | Structured tool call | Wall and recovery | Peak process RSS | Minimum reclaimable memory | Result |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 8,192 | 7,904 | PASS | PASS | PASS | 68.9 GiB | 28.0 GiB | PASS |
| 16,384 | 16,096 | PASS | PASS | PASS | 69.7 GiB | 25.8 GiB | PASS |
| 32,768 | 32,480 | PASS | PASS | PASS | 71.4 GiB | 25.8 GiB | PASS |
| 65,536 | 65,248 | PASS | PASS | PASS | 74.9 GiB | 24.2 GiB | PASS |
| 131,072 | 130,784 | PASS | PASS | PASS | 81.4 GiB | 22.9 GiB | PASS |
| 262,144 | 261,856 | PASS | PASS | PASS | 82.3 GiB | 18.6 GiB | PASS |

The full-window row also recorded an 88.1 GiB peak system-wired footprint. The
host was an Apple M4 Max with 128 GiB unified memory and
`iogpu.wired_limit_mb=129024`. The machine reported Low Power Mode during the
matrix, so the run is correctness and memory evidence—not a performance claim.

The private evidence package retains exact prompt arrays, output-token hashes,
memory samples, server logs, archive and launcher hashes, model signatures, and
host state. No model weights or user prompt data are included in this repository.
