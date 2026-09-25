// tests/openrouter-timeout.test.mjs — OPENROUTER_TIMEOUT_MS overrides the
// per-call model timeout in openrouter-runner.mjs (default stays 15 s).
//
// The timeout used to be a hard-coded 15_000 constant, too short for large
// prompts on slow free-tier or reasoning models. resolveModelTimeoutMs() is
// pure over an env object, so it is tested directly with no network.
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nopenrouter-runner — OPENROUTER_TIMEOUT_MS per-call timeout');

const { resolveModelTimeoutMs } = await import(pathToFileURL(join(ROOT, 'openrouter-runner.mjs')).href);

const cases = [
  ['unset keeps the 15000 ms default', {}, 15000],
  ['empty string keeps the default', { OPENROUTER_TIMEOUT_MS: '' }, 15000],
  ['a positive integer is used as-is', { OPENROUTER_TIMEOUT_MS: '60000' }, 60000],
  ['surrounding whitespace is tolerated', { OPENROUTER_TIMEOUT_MS: ' 45000 ' }, 45000],
  ['zero falls back to the default', { OPENROUTER_TIMEOUT_MS: '0' }, 15000],
  ['a negative value falls back to the default', { OPENROUTER_TIMEOUT_MS: '-5' }, 15000],
  ['a non-numeric value falls back to the default', { OPENROUTER_TIMEOUT_MS: 'abc' }, 15000],
  ['a unit suffix is rejected, not half-parsed', { OPENROUTER_TIMEOUT_MS: '30s' }, 15000],
  ['a decimal is rejected', { OPENROUTER_TIMEOUT_MS: '1.5' }, 15000],
  ['above the setTimeout ceiling falls back to the default', { OPENROUTER_TIMEOUT_MS: '2147483648' }, 15000],
];

// Invalid values warn on stderr by design; keep the suite output clean.
const originalWarn = console.warn;
let warnings = 0;
console.warn = () => { warnings++; };
try {
  for (const [label, env, expected] of cases) {
    const actual = resolveModelTimeoutMs(env);
    if (actual === expected) pass(`resolveModelTimeoutMs: ${label}`);
    else fail(`resolveModelTimeoutMs: ${label} — expected ${expected}, got ${actual}`);
  }
} finally {
  console.warn = originalWarn;
}

if (warnings === 6) pass('each invalid OPENROUTER_TIMEOUT_MS value produces a warning');
else fail(`expected 6 warnings for invalid values, got ${warnings}`);
