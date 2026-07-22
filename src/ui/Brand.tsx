import React from 'react';
import {Box, Text} from 'ink';
import {brandMarks} from '../branding.js';

export interface BrandProps {
  version: string;
}

function lineColor(index: number, count: number): 'cyan' | 'blue' | 'magenta' {
  const position = count <= 1 ? 0 : index / (count - 1);
  if (position < 0.34) return 'cyan';
  if (position < 0.67) return 'blue';
  return 'magenta';
}

export function Brand({version}: BrandProps): React.JSX.Element {
  const lines = brandMarks.silicon;
  return <Box flexDirection="column" marginBottom={1}>
    <Box flexDirection="column">
      {lines.map((line, index) => <Text key={`silicon:${index}`} bold color={lineColor(index, lines.length)}>{line}</Text>)}
    </Box>
    <Text dimColor>Frontier-scale local inference on Apple Silicon · v{version}</Text>
  </Box>;
}
