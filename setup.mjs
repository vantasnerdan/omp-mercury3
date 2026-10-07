#!/usr/bin/env node
import { constants } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isMap, isSeq, parseDocument } from 'yaml';

const MODEL_ID = 'mercury-3-preview-1002';
const EFFORTS = ['minimal', 'medium', 'high', 'max'];

function options(args) {
  const result = {
    modelsFile: join(process.env.PI_CODING_AGENT_DIR || join(homedir(), '.omp', 'agent'), 'models.yml'),
    contextWindow: 1_000_000,
    maxTokens: 32_768,
    thinking: 'high',
  };
  const names = new Map([
    ['--models-file', 'modelsFile'], ['--context-window', 'contextWindow'],
    ['--max-tokens', 'maxTokens'], ['--thinking', 'thinking'],
  ]);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') return null;
    const name = names.get(args[i]);
    if (!name || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Unknown option or missing value: ${args[i]}`);
    result[name] = args[++i];
  }
  for (const name of ['contextWindow', 'maxTokens']) {
    const value = String(result[name]);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw new Error(`${name} must be a positive integer.`);
    result[name] = Number(value);
  }
  if (result.maxTokens > 65_536) throw new Error('maxTokens must not exceed the tested API limit of 65,536.');
  if (result.contextWindow > 1_000_000) throw new Error('contextWindow must not exceed the configured preview capacity of 1,000,000.');
  if (result.maxTokens >= result.contextWindow) throw new Error('contextWindow must leave room for input in addition to maxTokens.');
  if (!EFFORTS.includes(result.thinking)) throw new Error(`thinking must be one of: ${EFFORTS.join(', ')}.`);
  result.modelsFile = resolve(result.modelsFile);
  return result;
}

function model(config) {
  return {
    id: MODEL_ID,
    name: 'Mercury 3 Preview (1002)',
    reasoning: true,
    thinking: {
      mode: 'effort', efforts: EFFORTS, defaultLevel: config.thinking,
      effortMap: { minimal: 'instant', medium: 'medium', high: 'high', max: 'max' },
    },
    input: ['text'],
    contextWindow: config.contextWindow,
    maxTokens: config.maxTokens,
    compat: {
      supportsStore: false, supportsDeveloperRole: false,
      supportsReasoningParams: true, supportsReasoningEffort: true,
      thinkingFormat: 'openai', maxTokensField: 'max_tokens',
    },
  };
}

function merge(source, config) {
  const doc = parseDocument(source);
  if (doc.errors.length) throw new Error('Existing models.yml is invalid YAML; no changes made.');
  if (doc.contents === null) doc.contents = doc.createNode({});
  if (!isMap(doc.contents)) throw new Error('models.yml must contain a YAML mapping.');
  if (!doc.has('providers')) doc.set('providers', doc.createNode({}));
  if (!isMap(doc.get('providers', true))) throw new Error('providers must be a YAML mapping.');
  if (!doc.hasIn(['providers', 'inception'])) doc.setIn(['providers', 'inception'], doc.createNode({}));
  if (!isMap(doc.getIn(['providers', 'inception'], true))) throw new Error('inception must be a YAML mapping.');
  for (const [key, value] of Object.entries({
    baseUrl: 'https://api.inceptionlabs.ai/v1', api: 'openai-completions',
    auth: 'apiKey', apiKey: 'INCEPTION_API_KEY',
  })) doc.setIn(['providers', 'inception', key], value);
  const path = ['providers', 'inception', 'models'];
  if (!doc.hasIn(path)) doc.setIn(path, doc.createNode([]));
  const models = doc.getIn(path, true);
  if (!isSeq(models) || models.items.some(item => !isMap(item))) throw new Error('inception.models must be a sequence of model mappings.');
  const matches = models.items.map((item, index) => item.get('id') === MODEL_ID ? index : -1).filter(index => index >= 0);
  if (matches.length > 1) throw new Error('Duplicate Mercury 3 definitions; resolve them before installing.');
  if (matches.length) models.set(matches[0], doc.createNode(model(config)));
  else models.add(doc.createNode(model(config)));
  // Per-model overrides take precedence over the definition being installed.
  if (doc.hasIn(['providers', 'inception', 'modelOverrides', MODEL_ID])) doc.deleteIn(['providers', 'inception', 'modelOverrides', MODEL_ID]);
  return doc.toString();
}

async function install(config) {
  let source = '';
  let exists = false;
  try { source = await readFile(config.modelsFile, 'utf8'); exists = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!exists && config.modelsFile.endsWith('models.yml')) {
    const legacyPath = config.modelsFile.slice(0, -3) + 'json';
    try {
      await readFile(legacyPath);
      throw new Error('Legacy models.json found. Run omp once to migrate it, then rerun setup.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const output = merge(source, config);
  if (exists && output === source) { console.log(`Already configured: ${config.modelsFile}`); return; }
  const directory = dirname(config.modelsFile);
  await mkdir(directory, { recursive: true });
  const temporary = await mkdtemp(join(directory, '.mercury3-'));
  try {
    const staged = join(temporary, 'models.yml');
    await writeFile(staged, output, { mode: 0o600 });
    if (exists) {
      const backup = `${config.modelsFile}.${randomUUID()}.bak`;
      await copyFile(config.modelsFile, backup, constants.COPYFILE_EXCL);
      await chmod(backup, 0o600);
      console.log(`Backup: ${backup} (local only; may contain existing credentials)`);
    }
    await rename(staged, config.modelsFile);
  } finally { await rm(temporary, { recursive: true, force: true }); }
  console.log(`Configured: ${config.modelsFile}`);
  console.log(`Model: inception/${MODEL_ID}; context: ${config.contextWindow}; maxTokens: ${config.maxTokens}; thinking: ${config.thinking}`);
  console.log('Credential reference: INCEPTION_API_KEY (no key read or stored).');
}

try {
  const config = options(process.argv.slice(2));
  if (!config) {
    console.log('Usage: ./setup.sh [--models-file PATH] [--context-window 1000000] [--max-tokens 32768] [--thinking high]\nThinking levels: minimal (API instant), medium, high, max. Requires Node.js 20+ and npm.');
  } else await install(config);
} catch (error) {
  console.error(`Setup failed: ${error.message}`);
  process.exitCode = 1;
}
