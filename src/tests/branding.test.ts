import assert from 'node:assert/strict';
import test from 'node:test';
import {logoLines, logoVariants} from '../branding.js';

test('ships every selectable logo within an 80-column terminal', () => {
  assert.deepEqual(logoVariants, ['silicon', 'big-iron', 'calvin', 'mini', 'classic', 'stream']);
  for (const variant of logoVariants) {
    assert.ok(logoLines[variant].length > 0, `${variant} has no lines`);
    for (const line of logoLines[variant]) {
      assert.ok([...line].length <= 80, `${variant} exceeds 80 columns`);
      assert.equal(line.trimEnd(), line, `${variant} has trailing whitespace`);
      assert.equal(line.includes('\t'), false, `${variant} contains a tab`);
    }
  }
});
