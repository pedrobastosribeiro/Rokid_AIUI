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

test('the secrets check allowlists public names and defaults to must-be-empty', () => {
  // An allowlist, not a guess at which names look secret. Enumerating secret
  // words means the first one nobody thought of -- API_AUTH, ACCESS_CODE,
  // PRIVATE_VALUE -- reaches a public repository, and the content scan is no
  // net there either: it knows two key shapes, so a provider using a third is
  // exactly the case that slips through both. An unfamiliar name has to fail.
  const validator = readFileSync(
    new URL('../scripts/ci/validate.mjs', import.meta.url),
    'utf8',
  );
  const list = validator.match(/const PUBLIC_NAMES = new Set\(\[([^\]]*)\]\)/);
  assert.ok(list, 'expected a PUBLIC_NAMES allowlist');
  const names = [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(names.sort(), ['REMOTE_BASE_URL', 'REMOTE_MODEL']);

  // The guard must skip the allowlisted names, not test for secret-looking
  // ones -- the inverted form is what let unfamiliar credentials through.
  assert.match(validator, /if \(PUBLIC_NAMES\.has\(name\)\) continue;/);
  assert.doesNotMatch(validator, /SECRET_NAME/);
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
  // `synchronize` must stay in, despite overlapping `push`. That overlap only
  // exists for branches in this repository: a fork contributor pushes to their
  // own fork, so the base repo sees no push, and without `synchronize` a fork
  // PR is checked once on `opened` while every later commit inherits that green
  // tick unverified. The duplicate run on same-repo PRs is cosmetic; a stale
  // pass on an unchecked commit is not.
  assert.match(trigger, /- synchronize/);
  assert.match(trigger, /branches-ignore:/);
  for (const branch of ['pt-br', 'pt-br-preview']) {
    assert.match(trigger, new RegExp(`^\\s*- ${branch}$`, 'm'), `${branch} must be excluded`);
  }

  // Both triggers must land in one concurrency group, or the same commit runs
  // twice rather than one superseding the other.
  const concurrency = workflow.slice(workflow.indexOf('concurrency:'));
  assert.match(concurrency, /pull_request\.head\.ref \|\| github\.ref_name/);
});

test('a decimal point is not a sentence end', () => {
  // "5.42" offers a period mid-token. Cutting there speaks "o dólar está a
  // cinco." and drops the rest -- worse than any mid-sentence cut, because the
  // number that was the answer is now wrong rather than merely incomplete.
  const text = 'O dólar está a 5.42 reais hoje e deve subir um pouco mais até o fim da semana';
  const clamped = clampSpeech(text, 45);
  assert.doesNotMatch(clamped, /5\.$/, `cut inside the number: ${clamped}`);
  assert.ok(clamped.length <= 45);
});

test('times and version numbers survive the clamp', () => {
  for (const text of [
    'A reunião começa às 14.30 e termina bem mais tarde do que estava planejado',
    'A versão 0.14.0 é a exigida pelo runtime atual dos óculos e não pode mudar',
  ]) {
    const clamped = clampSpeech(text, 40);
    assert.doesNotMatch(clamped, /\d\.$/, `cut inside a number: ${clamped}`);
  }
});

test('a terminator is judged against the full text, not the slice', () => {
  // A regex anchored on the sliced window treats the end of the slice as the
  // end of the string, so a limit landing right after the period in "5.42"
  // satisfies it and cuts inside the number -- a boundary that is an artefact
  // of where the budget fell, not of the sentence. The wearer hears "é 5." and
  // the figure that was the answer is now wrong rather than merely truncated.
  const text = 'O valor informado agora para a versão é 5.42 e continua depois';
  const clamped = clampSpeech(text, 42);
  assert.doesNotMatch(clamped, /\d\.$/, `cut inside the number: ${clamped}`);
});

test('CI does not cancel duplicate runs of the same commit', () => {
  // `push` and `pull_request` both fire for a commit on a same-repo branch.
  // Cancelling one of the pair made every healthy pull request render as "Some
  // checks were not successful", in red, because GitHub reports a cancelled
  // check as not successful. That is worse than noise: it teaches a reader to
  // treat red as normal, so a check that genuinely fails looks like the usual
  // background. Both runs complete instead, at about a minute of duplicated CI.
  const workflow = readFileSync(
    new URL('../.github/workflows/pr-checks.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /cancel-in-progress: false/);

  // The group still has to distinguish forks. It is inert while cancellation is
  // off, and wrong the moment anyone turns it back on.
  assert.match(workflow, /head\.repo\.full_name \|\| github\.repository/);
});
