export const brandMarks = {
  silicon: [
    '    ╷ ╷ ╷ ╷ ╷ ╷',
    '  ┌─┴─┴─┴─┴─┴─┴─┐',
    ' ─┤             ├─',
    ' ─┤   T E S S   ├─',
    ' ─┤ S E R V E R ├─',
    ' ─┤             ├─',
    '  └─┬─┬─┬─┬─┬─┬─┘',
    '    ╵ ╵ ╵ ╵ ╵ ╵',
  ],
  mini: [
    '▀█▀ █▀▀ █▀▀ █▀▀   █▀▀ █▀▀ █▀█ █ █ █▀▀ █▀█',
    ' █  █▄▄ ▄▄█ ▄▄█   ▄▄█ █▄▄ █▀▄ ▀▄▀ █▄▄ █▀▄',
  ],
  stream: ['░▒▓█ TESS SERVER █▓▒░ · local llm runtime'],
} as const;

export type BrandMark = keyof typeof brandMarks;
