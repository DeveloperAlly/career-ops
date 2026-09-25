// tests/openai-profile-context.test.mjs — openai-eval receives both profile
// sources, like ollama-eval does (#2488, tests/ollama-profile-context.test.mjs).
//
// openai-eval.mjs loaded config/profile.yml but never modes/_profile.md, so
// custom archetypes and narrative never reached the model. Run the real CLI
// from an isolated fixture root against a mock OpenAI-compatible server and
// check the system prompt it sends. A second leg points CAREER_OPS_DATA_DIR at
// a separate data directory to prove _profile.md is resolved through
// path-resolver.mjs (user layer), not next to the script (system layer).
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import {
  copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { pass, fail, NODE, ROOT } from './helpers.mjs';

console.log('\nopenai-eval — includes profile.yml and _profile.md in model context');

const fixtureRoot = mkdtempSync(join(ROOT, '.tmp-script-test-openai-profile-context-'));
const dataRoot = mkdtempSync(join(ROOT, '.tmp-script-test-openai-profile-data-'));
const copyIntoFixture = (relativePath) => {
  const destination = join(fixtureRoot, relativePath);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(join(ROOT, relativePath), destination);
};

for (const relativePath of [
  'openai-eval.mjs',
  'profile-language.mjs',
  'reserve-report-num.mjs',
  'tracker-aliases.json',
  'tracker-parse.mjs',
  'tracker-utils.mjs',
  'pipeline-lock.mjs',
  'path-resolver.mjs',
  'lib/context-budget.mjs',
  'lib/tracker-addition.mjs',
  'lib/is-main-module.mjs',
  'utils/token-tracker.mjs',
]) {
  copyIntoFixture(relativePath);
}

// System layer (always next to the script).
mkdirSync(join(fixtureRoot, 'modes'), { recursive: true });
writeFileSync(join(fixtureRoot, 'modes', '_shared.md'), 'SHARED CONTEXT\n');
writeFileSync(join(fixtureRoot, 'modes', 'oferta.md'), 'EVALUATION MODE\n');

// User layer, twice: once in the code root (default resolution) and once in a
// separate data dir (CAREER_OPS_DATA_DIR). Distinct sentinels tell them apart.
const writeUserLayer = (root, tag) => {
  mkdirSync(join(root, 'config'), { recursive: true });
  mkdirSync(join(root, 'modes'), { recursive: true });
  writeFileSync(join(root, 'config', 'profile.yml'), [
    'language:',
    '  output: en',
    `north_star: PROFILE_YML_SENTINEL_${tag}`,
    '',
  ].join('\n'));
  writeFileSync(join(root, 'modes', '_profile.md'), `PROFILE_MD_SENTINEL_${tag}\n`);
  writeFileSync(join(root, 'cv.md'), 'CANDIDATE CV\n');
};
writeUserLayer(fixtureRoot, 'CODE_ROOT');
writeUserLayer(dataRoot, 'DATA_DIR');

let capturedSystemPrompt = '';
const responseText = [
  'Evaluation complete.',
  '---SCORE_SUMMARY---',
  'COMPANY: Example',
  'ROLE: Engineer',
  'SCORE: 4.0',
  'ARCHETYPE: Builder',
  'LEGITIMACY: High Confidence',
  '---END_SUMMARY---',
].join('\n');

const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    try {
      const body = JSON.parse(raw);
      const content = body.messages?.find((message) => message.role === 'system')?.content ?? '';
      // String, or an array of content parts when cache_control is attached.
      capturedSystemPrompt = typeof content === 'string' ? content : JSON.stringify(content);
    } catch {
      capturedSystemPrompt = '';
    }
    // openai-eval requests `stream: true`, so answer as server-sent events.
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: responseText } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
});

// Hermetic env: no inherited provider/data-dir settings, and cwd inside the
// fixture so dotenv never picks up a contributor's real .env.
const baseEnv = { ...process.env };
for (const key of [
  'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'OPENAI_TIMEOUT_MS',
  'CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR', 'CAREER_OPS_ADDITIONS',
]) delete baseEnv[key];

const runEval = (port, extraEnv = {}) => new Promise((resolve) => {
  capturedSystemPrompt = '';
  execFile(
    NODE,
    [join(fixtureRoot, 'openai-eval.mjs'), '--url', `http://127.0.0.1:${port}/v1`, '--model', 'mock', '--no-save', 'On-site role.'],
    { timeout: 30000, cwd: fixtureRoot, env: { ...baseEnv, ...extraEnv } },
    (error, stdout, stderr) => resolve({ error, stdout, stderr, prompt: capturedSystemPrompt }),
  );
});

try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  // Leg 1: default resolution (data root == code root).
  const first = await runEval(port);
  if (first.error) {
    fail(`OpenAI fixture run failed: ${(first.stderr || first.error.message).trim().split('\n').pop()}`);
  } else {
    pass('runs the real OpenAI-compatible evaluator against the isolated mock server');
  }
  if (first.prompt.includes('PROFILE_YML_SENTINEL_CODE_ROOT')) {
    pass('sends config/profile.yml content to the OpenAI-compatible endpoint');
  } else {
    fail('config/profile.yml content is missing from the openai-eval system prompt');
  }
  if (first.prompt.includes('PROFILE_MD_SENTINEL_CODE_ROOT')) {
    pass('sends modes/_profile.md content to the OpenAI-compatible endpoint');
  } else {
    fail('modes/_profile.md content is missing from the openai-eval system prompt');
  }

  // Leg 2: CAREER_OPS_DATA_DIR moves the user layer; _profile.md must follow it.
  const second = await runEval(port, { CAREER_OPS_DATA_DIR: dataRoot });
  if (second.error) {
    fail(`OpenAI fixture run with CAREER_OPS_DATA_DIR failed: ${(second.stderr || second.error.message).trim().split('\n').pop()}`);
  } else if (second.prompt.includes('PROFILE_MD_SENTINEL_DATA_DIR')
    && !second.prompt.includes('PROFILE_MD_SENTINEL_CODE_ROOT')) {
    pass('reads modes/_profile.md from CAREER_OPS_DATA_DIR (user layer), not the code root');
  } else {
    fail('openai-eval did not resolve modes/_profile.md through CAREER_OPS_DATA_DIR');
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
  rmSync(fixtureRoot, { recursive: true, force: true });
  rmSync(dataRoot, { recursive: true, force: true });
}
