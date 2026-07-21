export const logoVariants = ['silicon', 'big-iron', 'calvin', 'mini', 'classic', 'stream'] as const;

export type LogoVariant = typeof logoVariants[number];

export function isLogoVariant(value: string): value is LogoVariant {
  return (logoVariants as readonly string[]).includes(value);
}

export const logoLines: Readonly<Record<LogoVariant, readonly string[]>> = {
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
  'big-iron': [
    '████████╗███████╗███████╗███████╗',
    '╚══██╔══╝██╔════╝██╔════╝██╔════╝',
    '   ██║   █████╗  ███████╗███████╗',
    '   ██║   ██╔══╝  ╚════██║╚════██║',
    '   ██║   ███████╗███████║███████║',
    '   ╚═╝   ╚══════╝╚══════╝╚══════╝',
    '─────────  S E R V E R  ─────────',
  ],
  calvin: [
    '╔╦╗╔═╗╔═╗╔═╗  ╔═╗╔═╗╦═╗╦  ╦╔═╗╦═╗',
    ' ║ ║╣ ╚═╗╚═╗  ╚═╗║╣ ╠╦╝╚╗╔╝║╣ ╠╦╝',
    ' ╩ ╚═╝╚═╝╚═╝  ╚═╝╚═╝╩╚═ ╚╝ ╚═╝╩╚═',
  ],
  mini: [
    '▀█▀ █▀▀ █▀▀ █▀▀   █▀▀ █▀▀ █▀█ █ █ █▀▀ █▀█',
    ' █  █▄▄ ▄▄█ ▄▄█   ▄▄█ █▄▄ █▀▄ ▀▄▀ █▄▄ █▀▄',
  ],
  classic: [
    ' _____                  ____',
    '|_   _|__  ___ ___     / ___|  ___ _ ____   _____ _ __',
    '  | |/ _ \\/ __/ __|    \\___ \\ / _ \\ \'__\\ \\ / / _ \\ \'__|',
    '  | |  __/\\__ \\__ \\     ___) |  __/ |   \\ V /  __/ |',
    '  |_|\\___||___/___/    |____/ \\___|_|    \\_/ \\___|_|',
  ],
  stream: ['░▒▓█ TESS SERVER █▓▒░ · local llm runtime'],
};
