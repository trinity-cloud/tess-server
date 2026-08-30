# Tess Server 0.1.6

Tess Server 0.1.6 adds Tess MLX, a C++ MLX engine for the exact 18-shard `mlx-community/DeepSeek-V4-Flash-0731-2.4bit-mixed` checkpoint at revision `10001e0065f8394e03e968e652cbbe7cd2ca122c`. The server, MLX 0.32.0 libraries, and compiled Metal library are bundled as one relocatable, checksum-bound arm64 payload. Python, mlx-lm, mlx-vlm, and oMLX are not included or required.

## Qualified behavior

- One local OpenAI-compatible endpoint on `127.0.0.1`, with the usual Tess alias, streaming and non-streaming chat completions, tool calls, cancellation, and optional file-backed bearer authentication.
- Exact model-file verification across the safetensors index, tokenizer/config metadata, and all 18 weight shards.
- Qualified 4K, 8K, 16K, and 32K context presets on the 128 GiB M4 Max campaign host.
- A single request slot and target-only generation. The unpublished Python/oMLX speculative path is not bundled, exposed, or claimed.
- No implicit download, runtime extraction, or mutation of the user's Python environment.

## Measured Tess MLX parity result

Against the pinned Python oracle on the same model and host, the production Tess MLX graph measured 336.26 prompt tokens/s versus 345.1, and 35.05 decode tokens/s versus 32.0. First decode was 28.62 ms, time to first token was within 2.69%, end-to-end wall time was 4.41% lower, and peak memory was 99.86% of the Python reference. Exact tokens, text, state, usage, finish reason, and lifecycle behavior remained the release gate.

These are same-artifact Python/Tess MLX measurements, not cross-format comparisons with the separately quantized GGUF profile. They do not imply quality equivalence between MLX and GGUF artifacts.

## Packaging and compatibility

The Tess MLX payload contains only the server executable, adjacent MLX/JACCL dynamic libraries, compiled `mlx.metallib`, a model contract, notices, and provenance. It contains no source code, Python files, model weights, or debug symbols. Runtime dependencies resolve relative to the executable and are verified again after relocation.

The MLX engine currently requires macOS 26.2 or newer. Existing GGUF profiles retain their prior macOS deployment target and engine routing. The public npm repository continues to contain no engine binaries or model weights; signed sidecar assets remain the release boundary.
