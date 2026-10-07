import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const script = fileURLToPath(new URL('../setup.mjs', import.meta.url));
const modelId = 'mercury-3-preview-1002';
const run = (path, ...args) => spawnSync(process.execPath, [script, '--models-file', path, ...args], { encoding: 'utf8', env: { ...process.env, INCEPTION_API_KEY: 'test-only-do-not-persist' } });

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'mercury3-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, path: join(dir, 'models.yml') };
}

test('adds a provider to fresh and existing registries without discarding prior data', async t => {
  for (const source of [null, 'providers:\n  other:\n    apiKey: OTHER_KEY\n']) {
    const { path } = await fixture(t);
    if (source !== null) await writeFile(path, source);
    const result = run(path);
    assert.equal(result.status, 0, result.stderr);
    const output = await readFile(path, 'utf8');
    const doc = parse(output);
    assert.equal(doc.providers.inception.models[0].id, modelId);
    if (source !== null) assert.deepEqual(doc.providers.other, parse(source).providers.other);
    assert.ok(!output.includes('test-only-do-not-persist'));
  }
});

test('preserves unrelated configuration, replaces the selected model, and is idempotent', async t => {
  const { dir, path } = await fixture(t);
  const source = `# Preserve this comment\nproviders:\n  other:\n    baseUrl: https://example.invalid/v1\n    apiKey: OTHER_KEY\n  inception:\n    models:\n      - id: mercury-2\n        contextWindow: 32000\n      - id: ${modelId}\n        contextWindow: 128000\n    modelOverrides:\n      ${modelId}:\n        maxTokens: 10\n      mercury-2:\n        name: Keep this\nequivalence:\n  exclude: [other/custom]\n`;
  await writeFile(path, source);
  const result = run(path, '--thinking', 'medium', '--max-tokens', '4096');
  assert.equal(result.status, 0, result.stderr);
  const output = await readFile(path, 'utf8');
  const doc = parse(output);
  assert.deepEqual(doc.providers.other, parse(source).providers.other);
  assert.deepEqual(doc.equivalence, parse(source).equivalence);
  assert.deepEqual(doc.providers.inception.models[0], { id: 'mercury-2', contextWindow: 32000 });
  assert.equal(doc.providers.inception.models.length, 2);
  assert.equal(doc.providers.inception.models[1].maxTokens, 4096);
  assert.equal(doc.providers.inception.models[1].thinking.defaultLevel, 'medium');
  assert.deepEqual(doc.providers.inception.modelOverrides, { 'mercury-2': { name: 'Keep this' } });
  assert.ok(output.includes('# Preserve this comment'));
  assert.ok(!output.includes('test-only-do-not-persist'));
  if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600);
  const backups = (await readdir(dir)).filter(file => file.endsWith('.bak'));
  assert.equal(backups.length, 1);
  assert.equal(await readFile(join(dir, backups[0]), 'utf8'), source);
  assert.equal(run(path, '--thinking', 'medium', '--max-tokens', '4096').status, 0);
  assert.equal(await readFile(path, 'utf8'), output);
  assert.deepEqual((await readdir(dir)).filter(file => file.endsWith('.bak')), backups);
});

test('malformed YAML and duplicate definitions leave existing files untouched', async t => {
  const { dir, path } = await fixture(t);
  for (const source of ['providers: [unterminated', `providers:\n  inception:\n    models:\n      - id: ${modelId}\n      - id: ${modelId}\n`]) {
    await writeFile(path, source);
    assert.notEqual(run(path).status, 0);
    assert.equal(await readFile(path, 'utf8'), source);
    assert.deepEqual(await readdir(dir), ['models.yml']);
  }
});

test('invalid budgets and unmapped effort levels do not create a config', async t => {
  const { dir, path } = await fixture(t);
  for (const args of [['--max-tokens', '65537'], ['--max-tokens', '0'], ['--max-tokens', '1e3'], ['--context-window', '1000001'], ['--context-window', '100', '--max-tokens', '100'], ['--thinking', 'low']]) {
    assert.notEqual(run(path, ...args).status, 0);
    assert.deepEqual(await readdir(dir), []);
  }
});

test('a legacy JSON registry is not shadowed by a new YAML registry', async t => {
  const { dir, path } = await fixture(t);
  const legacy = join(dir, 'models.json');
  const source = '{"providers":{"other":{"apiKey":"OTHER_KEY"}}}';
  await writeFile(legacy, source);
  assert.notEqual(run(path).status, 0);
  assert.equal(await readFile(legacy, 'utf8'), source);
  assert.deepEqual(await readdir(dir), ['models.json']);
});
