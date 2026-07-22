# Tess Server brand system

Tess Server uses one terminal-native visual identity. The TUI applies a
dependency-free cyan-to-magenta treatment while the marks remain legible in
monochrome documentation and copied terminal text.

## Silicon — primary mark

Use Silicon for the public face of Tess Server: repository headers, launch and
model-discovery screens, release announcements, and other places where the full
identity should lead.

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

## Mini — compact product mark

Use Mini as the persistent header on configuration, model-detail, and server
status screens. It keeps the Tess Server identity visible without taking space
from the user's work.

```text
▀█▀ █▀▀ █▀▀ █▀▀   █▀▀ █▀▀ █▀█ █ █ █▀▀ █▀█
 █  █▄▄ ▄▄█ ▄▄█   ▄▄█ █▄▄ █▀▄ ▀▄▀ █▄▄ █▀▄
```

## Stream — secondary accent

Use Stream sparingly in compact promotional or status contexts where neither
primary mark fits. It is an accent, not an alternate logo or a selectable TUI
theme.

```text
░▒▓█ TESS SERVER █▓▒░ · local llm runtime
```

## Usage rules

- Do not offer alternate marks or user-selectable logo themes in the product.
- Keep the artwork monospace-aligned and within 80 terminal columns.
- Preserve the exact lettering, proportions, and whitespace shown above.
- Prefer the cyan-to-magenta treatment on dark terminals and monochrome text
  where color is unavailable.
