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
