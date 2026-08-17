import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CONCISION_RULES,
  MAX_SPEECH_CHARS,
  clampSpeech,
  getJsonReplyInstruction,
  parseTwoChannelReply,
} from '../samples/pt-br/lib/reply-format.js';

// --- speech bound ----------------------------------------------------------

test('a reply already within budget is spoken unchanged', () => {
  const reply = 'O dólar está a cinco reais e quarenta e dois centavos.';
  assert.equal(clampSpeech(reply), reply);
});

test('speech is cut at a sentence end, not at a character count', () => {
  // Audio has no equivalent of the HUD's "…": a clause that stops mid-breath
  // just sounds like the device broke, so the cut has to land on a cadence the
  // ear reads as finished.
  const text = 'Primeira frase curta. Segunda frase curta. Terceira frase que passa do limite.';
  const clamped = clampSpeech(text, 45);
  assert.equal(clamped, 'Primeira frase curta. Segunda frase curta.');
});

test('one unbroken sentence falls back to a word boundary and is marked', () => {
  const text = 'palavra '.repeat(60).trim();
  const clamped = clampSpeech(text, 40);
  assert.ok(clamped.endsWith('…'));
  assert.doesNotMatch(clamped, /palavr…$/, 'must not cut mid-word');
});

test('the bound holds including the ellipsis', () => {
  // The fallback branch is the only one that adds a character, so it is the one
  // that could overrun the budget it exists to enforce.
  for (const limit of [10, 25, 40, 120]) {
    assert.ok(clampSpeech('palavra '.repeat(80), limit).length <= limit);
    assert.ok(clampSpeech('Frase. '.repeat(80), limit).length <= limit);
  }
});

test('the default speech budget is about fifteen seconds of audio', () => {
  // `speechSynthesis.cancel()` is not exposed on the glasses, so this number is
  // how long a wearer can be made to wait with no way out. At ~14 pt-BR
  // characters a second it should stay in that range; a large bump here is a
  // decision about the wearer's time, not a formatting tweak.
  assert.ok(MAX_SPEECH_CHARS >= 120 && MAX_SPEECH_CHARS <= 320);
});

test('speech clamping tolerates non-strings', () => {
  assert.equal(clampSpeech(null), '');
  assert.equal(clampSpeech(undefined), '');
  assert.equal(clampSpeech(42), '');
});

// --- two-channel reply -----------------------------------------------------

test('a well-formed reply yields separate spoken and display text', () => {
  const parsed = parseTwoChannelReply('{"fala":"O dólar está a cinco e quarenta e dois.","tela":"USD 5,42"}');
  assert.equal(parsed.fala, 'O dólar está a cinco e quarenta e dois.');
  assert.equal(parsed.tela, 'USD 5,42');
  assert.equal(parsed.structured, true);
});

test('a fenced JSON block is unwrapped', () => {
  // `json_object` mode constrains the body but not the wrapper, and fenced
  // output is the common way it arrives anyway.
  const parsed = parseTwoChannelReply('```json\n{"fala":"São dez horas.","tela":"10:00"}\n```');
  assert.equal(parsed.fala, 'São dez horas.');
  assert.equal(parsed.tela, '10:00');
  assert.equal(parsed.structured, true);
});

test('plain prose degrades into a usable reply instead of an error', () => {
  // A provider or gateway that ignores the response format returns prose. Speech
  // is the channel with no fallback, so it has to get something.
  const parsed = parseTwoChannelReply('Está fazendo vinte e dois graus.');
  assert.equal(parsed.fala, 'Está fazendo vinte e dois graus.');
  assert.equal(parsed.tela, 'Está fazendo vinte e dois graus.');
  assert.equal(parsed.structured, false);
});

test('JSON missing the display field still speaks', () => {
  const parsed = parseTwoChannelReply('{"fala":"Amanhã chove."}');
  assert.equal(parsed.fala, 'Amanhã chove.');
  assert.equal(parsed.tela, 'Amanhã chove.');
  assert.equal(parsed.structured, true);
});

test('JSON missing the spoken field is treated as unstructured', () => {
  // `tela` alone is not a reply -- there would be nothing to say out loud, and a
  // silent glasses agent is the failure this whole sample exists to avoid.
  const parsed = parseTwoChannelReply('{"tela":"USD 5,42"}');
  assert.equal(parsed.structured, false);
  assert.ok(parsed.fala, 'must fall back to the raw text rather than go silent');
});

test('an empty reply stays empty rather than becoming a stray string', () => {
  for (const value of ['', '   ', null, undefined]) {
    const parsed = parseTwoChannelReply(value);
    assert.equal(parsed.fala, '');
    assert.equal(parsed.tela, '');
    assert.equal(parsed.structured, false);
  }
});

test('malformed JSON is spoken as-is rather than thrown', () => {
  const parsed = parseTwoChannelReply('{"fala": "cortado ao meio');
  assert.equal(parsed.structured, false);
  assert.ok(parsed.fala.length > 0);
});

// --- prompt rules ----------------------------------------------------------

test('the display instruction carries the caller-supplied limit', () => {
  // The HUD budget is derived from panel arithmetic in the page, so it is passed
  // in rather than duplicated here, where it would drift.
  assert.match(getJsonReplyInstruction(100), /100 caracteres/);
  assert.match(getJsonReplyInstruction(64), /64 caracteres/);
});

test('the concision rules ban ritual, not just length', () => {
  // Most of an LLM reply's length is ceremony rather than content. Naming the
  // parts is what buys brevity without making the reply sound clipped.
  const rules = CONCISION_RULES.join(' ');
  assert.match(rules, /no máximo duas frases/);
  assert.match(rules, /sem preâmbulo/);
  assert.match(rules, /sem repetir a pergunta/);
  assert.match(rules, /sem se oferecer para detalhar/);
});

// --- CI wiring -------------------------------------------------------------

test('every validator check is invoked by the CI workflow', () => {
  // The workflow names each check explicitly instead of running the validator
  // whole, so a check added to validate.mjs silently does not run in CI until
  // it is also added there. `secrets` spent a day in exactly that gap, which
  // mattered because it is the only backstop covering a commit authored in the
  // GitHub web UI -- no local hook runs on that path.
  const validator = readFileSync(
    new URL('../scripts/ci/validate.mjs', import.meta.url),
    'utf8',
  );
  const workflow = readFileSync(
    new URL('../.github/workflows/pr-checks.yml', import.meta.url),
    'utf8',
  );

  const block = validator.slice(validator.indexOf('const checks = {'));
  // The validator runs every `Object.keys(checks)` entry, so anything this
  // regex fails to recognise is a check that runs under `npm test` and is
  // exempt from the parity it is supposed to be held to. Accepting the full
  // identifier alphabet plus quoted keys keeps the two sets describing the
  // same thing; a narrower pattern would let `reply_format` or `'json-2'`
  // slip past the very assertion meant to catch them.
  const declared = [
    ...block.matchAll(/^ {2}(?:['"]([^'"]+)['"]|([A-Za-z_$][\w$]*))\(fail, note\)/gm),
  ].map((m) => m[1] || m[2]);
  assert.ok(declared.length >= 8, `expected the check list, found ${declared.join(', ')}`);

  // Anchored on `run:` rather than on the filename. Prose mentioning
  // validate.mjs -- including the comment above the step this test exists to
  // protect -- would otherwise be read as an invocation and quietly widen the
  // set, which is the one way a parity check like this fails open.
  const invoked = new Set(
    [...workflow.matchAll(/run:\s*node scripts\/ci\/validate\.mjs ([a-z][a-z ]*)/g)].flatMap((m) =>
      m[1].trim().split(/\s+/),
    ),
  );
  const missing = declared.filter((name) => !invoked.has(name));
  assert.deepEqual(missing, [], `checks defined but never run in CI: ${missing.join(', ')}`);
});

test('the key scan matches project-scoped keys containing underscores', () => {
  // A class that stops at `_` cannot then satisfy a trailing `\b`, because `_`
  // is itself a word character -- so `sk-proj-<seg>_<seg>` failed to match at
  // all and sailed through. A scanner that silently misses a current key format
  // is worse than no scanner, because it is trusted.
  const validator = readFileSync(
    new URL('../scripts/ci/validate.mjs', import.meta.url),
    'utf8',
  );
  const shapes = [...validator.matchAll(/\[(\/\\b(?:gsk_|sk-)[^/]+\/), '/g)].map((m) => m[1]);
  assert.equal(shapes.length, 2, `expected two key shapes, got ${shapes.join(' ')}`);

  const samples = [
    'gsk_' + 'a'.repeat(44),
    'sk-' + 'b'.repeat(44),
    'sk-proj-' + 'c'.repeat(30) + '_' + 'd'.repeat(20),
    'gsk_' + 'e'.repeat(20) + '_' + 'f'.repeat(30),
  ];
  for (const sample of samples) {
    const hit = shapes.some((source) => {
      const body = source.slice(1, source.lastIndexOf('/'));
      return new RegExp(body).test(`const K = '${sample}';`);
    });
    assert.ok(hit, `no key shape matched ${sample.slice(0, 12)}…`);
  }
});

test('the secrets check enforces emptiness only on secret-bearing names', () => {
  // `secrets.js` also carries REMOTE_BASE_URL and REMOTE_MODEL, which the
  // sample's README tells you to fill in to aim at another provider and which
  // must survive into the packed app. Requiring every uppercase export to be
  // empty made the documented customisation impossible to commit.
  const validator = readFileSync(
    new URL('../scripts/ci/validate.mjs', import.meta.url),
    'utf8',
  );
  const pattern = validator.match(/const SECRET_NAME = (\/[^/]+\/)/);
  assert.ok(pattern, 'expected a SECRET_NAME pattern');
  const body = pattern[1].slice(1, -1);
  const matcher = new RegExp(body);
  for (const name of ['REMOTE_API_KEY', 'AUTH_TOKEN', 'CLIENT_SECRET']) {
    assert.ok(matcher.test(name), `${name} should be treated as a secret`);
  }
  for (const name of ['REMOTE_BASE_URL', 'REMOTE_MODEL']) {
    assert.ok(!matcher.test(name), `${name} is public configuration, not a secret`);
  }
});

test('an early abbreviation does not truncate the whole reply', () => {
  // "O Dr. Silva recomenda…" puts a period four characters in. Cutting there
  // would speak "O Dr." and discard the answer, which is far worse than the
  // mid-sentence cut the sentence-boundary branch exists to avoid.
  const text = 'O Dr. Silva recomenda descansar bastante e beber muita água durante o dia todo';
  const clamped = clampSpeech(text, 50);
  assert.notEqual(clamped, 'O Dr.');
  assert.ok(clamped.length > 25, `cut far too early: ${clamped}`);
  assert.ok(clamped.length <= 50);
});

test('a genuine sentence end near the budget is still preferred', () => {
  // The abbreviation guard must not cost the normal case: when a real sentence
  // closes late in the window, that is still the right place to stop.
  const text = 'Está fazendo vinte e dois graus agora. Deve chover mais tarde na cidade toda.';
  const clamped = clampSpeech(text, 45);
  assert.equal(clamped, 'Está fazendo vinte e dois graus agora.');
});

test('CI runs on push and skips the generated publish branches', () => {
  // `pull_request` alone proved undeliverable, so `push` is the redundancy that
  // keeps a pull request covered -- check runs attach to the head commit either
  // way. But the generated branches must stay excluded: their root is the
  // sample, not the repository, so there is no validator there to run, and
  // `pt-br` is force-pushed on every push to `main`. Without the exclusion,
  // every commit to main would gain a second run that always fails.
  const workflow = readFileSync(
    new URL('../.github/workflows/pr-checks.yml', import.meta.url),
    'utf8',
  );
  const trigger = workflow.slice(0, workflow.indexOf('concurrency:'));
  assert.match(trigger, /^\s*push:/m);
  assert.match(trigger, /^\s*pull_request:/m);
  assert.match(trigger, /branches-ignore:/);
  for (const branch of ['pt-br', 'pt-br-preview']) {
    assert.match(trigger, new RegExp(`^\\s*- ${branch}$`, 'm'), `${branch} must be excluded`);
  }

  // Both triggers must land in one concurrency group, or the same commit runs
  // twice rather than one superseding the other.
  const concurrency = workflow.slice(workflow.indexOf('concurrency:'));
  assert.match(concurrency, /pull_request\.head\.ref \|\| github\.ref_name/);
});
