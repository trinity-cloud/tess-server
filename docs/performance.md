# Performance and methodology

This page reports the common-protocol qualification sweep retained from the five-profile Tess Server RC2 candidate. It intentionally describes measured product behavior without disclosing proprietary engine implementation details. The current six-profile package adds Laguna S.2; its performance row remains unpublished until it clears this same protocol end to end.

## Qualification host

- Apple M4 Max
- 128 GiB unified memory
- macOS 26.2
- AC power, full battery, and maximum fan cooling reported by the operator
- GPU wired-memory limit set to `129024` MiB
- No concurrent known GPU workload
- No macOS thermal or performance warning before or after any measured row

The measured five-profile engine was built from commit `ca8c27d39244ec3c595de52be1442051868ffb08` and packaged as `0.1.0-rc.2`. These values are retained evidence, not a claim that all six profiles were re-swept on one final build.

## Common protocol

Each model ran alone through its packaged default profile. The measurement used:

- One 256-token prompt and 8-token warmup.
- One exact 24,576-token chat-templated prompt.
- Exactly 1,024 requested generated tokens.
- Temperature zero and seed `1234`.
- Prompt caching disabled.
- One server slot.
- A five-position literal recall check distributed through the prompt.
- Model-file signatures captured before and after the request.
- Memory, power, thermal, process, and clean-shutdown checks.

All five rows evaluated exactly 24,576 prompt tokens, generated exactly 1,024 tokens, stopped at the requested limit, passed the recall check, left the source model files unchanged, and released their port after shutdown.

## Results

| Model | Prefill | Decode | Wall time | Peak process RSS | Minimum reclaimable memory |
|---|---:|---:|---:|---:|---:|
| **Tess-4 / Qwen3.6-35B-A3B** | **1,286.32 tok/s** | **102.31 tok/s** | 29.13 s | 38.75 GiB | 66.94 GiB |
| **NVIDIA Nemotron-3-Super** | **379.03 tok/s** | **27.62 tok/s** | 101.93 s | 76.77 GiB | 31.85 GiB |
| **DeepSeek-V4-Flash** | **245.91 tok/s** | **29.16 tok/s** | 135.10 s | 106.71 GiB | 1.96 GiB |
| **MiniMax-M2.7** | **252.26 tok/s** | **21.28 tok/s** | 145.55 s | 104.33 GiB | 5.81 GiB |
| **Tencent Hy3** | **145.37 tok/s** | **18.84 tok/s** | 223.42 s | 104.72 GiB | 5.26 GiB |

Wall time covers the measured request, including prefill, generation, and request overhead. Prefill and decode values come from the server's phase timings.

DeepSeek-V4-Flash had the narrowest observed memory margin. Users should avoid running other memory-heavy applications beside the 90+ GiB profiles.

## Interpreting the numbers

These rows are directly comparable because they use the same prompt depth and requested output length. They are not comparisons with another runtime and they are not the maximum speed each model can reach on a short prompt.

Decode normally decreases as the active context grows because each generated token must operate against more prior context. A shallow interactive request may therefore run faster than the 24K results above, while substantially deeper sessions may run slower.

Apple Silicon throughput also depends on chassis temperature, airflow, ambient temperature, memory pressure, and other GPU activity. Do not treat a single run as a hardware guarantee.

## Correctness claim

Release profiles are validated against recorded deterministic probes and product-level correctness checks. Any statement about exact output applies only to the model, configuration, prompt, generation length, and engine build covered by its evidence.

Rare token differences during very long speculative generations remain under investigation for some profiles. Every generated token is still verified by the loaded target model, but Tess Server does not claim unbounded bit identity beyond the recorded validation scope.

## Evidence record

The public values on this page trace to the internal evidence record `five-model-24k-prefill-1024-decode`, dated July 21, 2026. Raw records include exact token arrays and local filesystem metadata and are intentionally not published in this repository.
