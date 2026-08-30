# Third-party notices

Tess Server is a proprietary distribution built on open-source foundations. The following components are statically linked into its engines or shipped as adjacent native libraries. Their licenses travel with every copy; nothing in the Tess license limits your rights under them.

| Component | License | Role |
|---|---|---|
| [llama.cpp](https://github.com/ggml-org/llama.cpp) | MIT (© 2023–2026 The ggml authors) | Inference engine foundation (Tess Server is built from a modified fork) |
| [ggml](https://github.com/ggml-org/ggml) | MIT | Tensor/compute library, Metal backend foundation |
| [cpp-httplib](https://github.com/yhirose/cpp-httplib) | MIT | HTTP server |
| [nlohmann/json](https://github.com/nlohmann/json) | MIT | JSON parsing/serialization |
| [stb](https://github.com/nothings/stb) | MIT / public domain | Image utilities (vendored) |
| [sheredom subprocess.h](https://github.com/sheredom/subprocess.h) | Unlicense / public domain | Local subprocess support used by server model/tool plumbing |
| [miniaudio](https://github.com/mackron/miniaudio) | MIT-0 / public domain | Audio decoding utilities linked through the multimodal server support library |
| [Poolside Laguna S 2.1 chat template](https://huggingface.co/poolside/Laguna-S-2.1-GGUF/blob/main/chat_template.jinja) | OpenMDW-1.1 | Model-authored prompt, reasoning, and tool-call serialization for the verified Laguna profile |
| [MLX](https://github.com/ml-explore/mlx) | MIT (© 2023 Apple Inc.) | Adjacent Apple Silicon array/runtime libraries and compiled Metal library used by Tess MLX |

The selected license texts are reproduced in the release archive under `share/tess-server/licenses/`, and the exact Tess MLX dependency inventory is recorded in `share/tess-server/mlx/tess-mlx-manifest.json` and the release SPDX SBOM. The product contains no Python interpreter, Python packages, Python bytecode, or model weights.

Trinity Cloud's proprietary modifications to llama.cpp/ggml are © Trinity Cloud, Inc. and are not open source. The MIT licenses and attribution of the upstream foundations remain fully effective and are not obscured by this distribution.
