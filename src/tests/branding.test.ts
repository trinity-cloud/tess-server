import assert from 'node:assert/strict';
import test from 'node:test';
import {brandMarks} from '../branding.js';

test('ships the locked brand marks within an 80-column terminal', () => {
  assert.deepEqual(Object.keys(brandMarks), ['silicon', 'mini', 'stream']);
  for (const [mark, lines] of Object.entries(brandMarks)) {
    assert.ok(lines.length > 0, `${mark} has no lines`);
    for (const line of lines) {
      assert.ok([...line].length <= 80, `${mark} exceeds 80 columns`);
      assert.equal(line.trimEnd(), line, `${mark} has trailing whitespace`);
      assert.equal(line.includes('\t'), false, `${mark} contains a tab`);
    }
  }
});
