import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {packageRoot} from '../paths.js';

const templatePath = join(packageRoot, 'templates', 'laguna-s21-chat-template.jinja');
const launcherPath = join(packageRoot, 'scripts', 'serve', 'serve-laguna.sh');
const stagePath = join(packageRoot, 'scripts', 'stage-release.sh');

test('packages Poolside native reasoning and tagged tool-call serialization for Laguna', async () => {
  const template = await readFile(templatePath, 'utf8');
  assert.match(template, /set enable_thinking = enable_thinking \| default\(true\)/);
  assert.match(template, /'<tool_call>' \+ function_data\.name/);
  assert.match(template, /"<arg_key>" ~ k ~ "<\/arg_key>"/);
  assert.match(template, /"<arg_value>"/);
  assert.match(template, /message\.reasoning_content/);
});

test('verified Laguna launches require the checksummed packaged template', async () => {
  const launcher = await readFile(launcherPath, 'utf8');
  assert.match(launcher, /tess_verify_payload_file "\$CHAT_TEMPLATE_REL"/);
  assert.match(launcher, /--jinja --chat-template-file "\$CHAT_TEMPLATE"/);
  assert.match(launcher, /--reasoning on --reasoning-preserve/);
});

test('release staging includes the Laguna template and its license', async () => {
  const stage = await readFile(stagePath, 'utf8');
  assert.match(stage, /templates\/laguna-s21-chat-template\.jinja/);
  assert.match(stage, /poolside-OpenMDW-1\.1\.txt/);
  assert.match(stage, /-name "\*\.jinja"/);
});
