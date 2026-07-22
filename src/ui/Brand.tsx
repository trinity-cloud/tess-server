import React from 'react';
import {Box, Text} from 'ink';
import {brandMarks} from '../branding.js';

export interface BrandProps {
  version: string;
  compact?: boolean;
}

function lineColor(index: number, count: number): 'cyan' | 'blue' | 'magenta' {
  const position = count <= 1 ? 0 : index / (count - 1);
  if (position < 0.34) return 'cyan';
  if (position < 0.67) return 'blue';
  return 'magenta';
}

export function Brand({version, compact = false}: BrandProps): React.JSX.Element {
  const mark = compact ? 'mini' : 'silicon';
  const lines = brandMarks[mark];
  return <Box flexDirection="column" marginBottom={1}>
    <Box flexDirection="column">
      {lines.map((line, index) => <Text key={`${mark}:${index}`} bold color={lineColor(index, lines.length)}>{line}</Text>)}
    </Box>
    <Text dimColor>Frontier-scale local inference on Apple Silicon · v{version}</Text>
  </Box>;
}
