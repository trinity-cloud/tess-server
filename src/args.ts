import {isLogoVariant, type LogoVariant} from './branding.js';

export type CommandName = 'tui' | 'profiles' | 'models' | 'doctor' | 'verify' | 'serve' | 'engine' | 'help';

export interface CliOptions {
  command: CommandName;
  modelRoots: string[];
  profile?: string;
  model?: string;
  draft?: string;
  context?: number;
  logo: LogoVariant;
  port?: number;
  alias?: string;
  apiKeyFile?: string;
  noAuth: boolean;
  speculation?: 'dspark' | 'off';
  draftDepth?: number;
  pMin?: number;
  reasoning?: 'full' | 'low' | 'off';
  preserveReasoning?: boolean;
  kvQuality?: string;
  printConfig: boolean;
  sidecarRoot?: string;
  json: boolean;
  version: boolean;
  engineArgs: string[];
}

const commands = new Set<CommandName>(['tui', 'profiles', 'models', 'doctor', 'verify', 'serve', 'engine', 'help']);

function positiveInteger(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function boundedNumber(name: string, value: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  return parsed;
}

export function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {command: 'tui', modelRoots: [], logo: 'silicon', noAuth: false, printConfig: false, json: false, version: false, engineArgs: []};
  let index = 0;
  if (argv[0] && !argv[0].startsWith('-') && commands.has(argv[0] as CommandName)) {
    options.command = argv[0] as CommandName;
    index = 1;
  }
  if (options.command === 'engine') {
    options.engineArgs = argv.slice(index + (argv[index] === '--' ? 1 : 0));
    return options;
  }

  const takeValue = (flag: string): string => {
    index += 1;
    const value = argv[index];
    if (!value) {
      throw new Error(`${flag} requires a value`);
    }
    return value;
  };

  for (; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case '--model-root': options.modelRoots.push(takeValue(argument)); break;
      case '--profile': options.profile = takeValue(argument); break;
      case '--model': options.model = takeValue(argument); break;
      case '--draft': options.draft = takeValue(argument); break;
      case '--context': options.context = positiveInteger(argument, takeValue(argument)); break;
      case '--logo': {
        const value = takeValue(argument);
        if (!isLogoVariant(value)) throw new Error('--logo must be silicon, big-iron, calvin, mini, classic, or stream');
        options.logo = value;
        break;
      }
      case '--port': {
        const port = positiveInteger(argument, takeValue(argument));
        if (port > 65535) {
          throw new Error('--port must be at most 65535');
        }
        options.port = port;
        break;
      }
      case '--alias': options.alias = takeValue(argument); break;
      case '--api-key-file': options.apiKeyFile = takeValue(argument); break;
      case '--no-auth': options.noAuth = true; break;
      case '--speculation': {
        const value = takeValue(argument);
        if (value !== 'dspark' && value !== 'off') throw new Error('--speculation must be dspark or off');
        options.speculation = value;
        break;
      }
      case '--draft-depth': options.draftDepth = positiveInteger(argument, takeValue(argument)); break;
      case '--p-min': options.pMin = boundedNumber(argument, takeValue(argument), 0, 1); break;
      case '--reasoning': {
        const value = takeValue(argument);
        if (value !== 'full' && value !== 'low' && value !== 'off') throw new Error('--reasoning must be full, low, or off');
        options.reasoning = value;
        break;
      }
      case '--preserve-reasoning': options.preserveReasoning = true; break;
      case '--no-preserve-reasoning': options.preserveReasoning = false; break;
      case '--kv-quality': options.kvQuality = takeValue(argument); break;
      case '--print-config': options.printConfig = true; break;
      case '--sidecar-root': options.sidecarRoot = takeValue(argument); break;
      case '--json': options.json = true; break;
      case '--version': case '-v': options.version = true; break;
      case '--help': case '-h': options.command = 'help'; break;
      default: throw new Error(`unknown argument: ${argument}`);
    }
  }
  return options;
}
