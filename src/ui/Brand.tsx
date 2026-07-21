import React from 'react';
import {Box, Text} from 'ink';
import {logoLines, type LogoVariant} from '../branding.js';

export interface BrandProps {
  variant: LogoVariant;
  version: string;
  compact?: boolean;
}

function lineColor(index: number, count: number): 'cyan' | 'blue' | 'magenta' {
  const position = count <= 1 ? 0 : index / (count - 1);
  if (position < 0.34) return 'cyan';
  if (position < 0.67) return 'blue';
  return 'magenta';
}

export function Brand({variant, version, compact = false}: BrandProps): React.JSX.Element {
  const renderedVariant: LogoVariant = compact ? 'mini' : variant;
  const lines = logoLines[renderedVariant];
  return <Box flexDirection="column" marginBottom={1}>
    <Box flexDirection="column">
      {lines.map((line, index) => <Text key={`${renderedVariant}:${index}`} bold color={lineColor(index, lines.length)}>{line}</Text>)}
    </Box>
    <Text dimColor>Frontier-scale local inference on Apple Silicon · v{version}</Text>
  </Box>;
}
