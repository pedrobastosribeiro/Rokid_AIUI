import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  COPY,
  TARGET_LOCALE,
  getAsrFailureMessage,
  getHostLanguage,
  getLanguageModelOptions,
  getSystemPrompt,
  isPortuguese,
  normalizeLocale,
} from '../samples/pt-br/lib/locale.js';

test('pins the glasses locale to pt-BR', () => {
  assert.equal(TARGET_LOCALE, 'pt-BR');
});

test('normalizes BCP 47 tags', () => {
  assert.equal(normalizeLocale('pt_br'), 'pt-BR');
  assert.equal(normalizeLocale('PT-br'), 'pt-BR');
  assert.equal(normalizeLocale('pt'), 'pt');
  assert.equal(normalizeLocale(''), '');
  assert.equal(normalizeLocale(null), '');
});

test('detects Portuguese tags', () => {
  assert.equal(isPortuguese('pt-BR'), true);
  assert.equal(isPortuguese('pt'), true);
  assert.equal(isPortuguese('pt-PT'), true);
  assert.equal(isPortuguese('en-US'), false);
  assert.equal(isPortuguese(''), false);
});

test('reads host language from navigator when present', () => {
  const language = getHostLanguage();
  assert.equal(typeof language, 'string');
  if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
    assert.equal(language, navigator.language);
  }
});

test('forces the glasses voice into Brazilian Portuguese', () => {
  const prompt = getSystemPrompt();
  assert.match(prompt, /voz dos óculos Rokid/);
  assert.match(prompt, /português brasileiro \(pt-BR\)/);
  assert.match(prompt, /não um aplicativo à parte/);

  const options = getLanguageModelOptions();
  assert.equal(options.initialPrompts[0].role, 'system');
  assert.equal(options.initialPrompts[0].content, prompt);
});

test('maps ASR failures to short pt-BR retry copy', () => {
  assert.equal(getAsrFailureMessage({ error: 'no-speech' }), COPY.asrNoSpeech);
  assert.equal(getAsrFailureMessage({ error: 'aborted' }), COPY.asrAborted);
  assert.equal(getAsrFailureMessage({ error: 'audio-capture' }), COPY.asrAudioCapture);
  assert.equal(getAsrFailureMessage({ error: 'network' }), COPY.asrNetwork);
  assert.equal(getAsrFailureMessage({ error: 'not-allowed' }), COPY.asrNotAllowed);
  assert.equal(
    getAsrFailureMessage({ error: 'service-not-allowed' }),
    COPY.asrNotAllowed,
  );
  assert.equal(
    getAsrFailureMessage({ error: 'language-not-supported' }),
    COPY.asrLanguage,
  );
  assert.equal(getAsrFailureMessage({ error: 'unknown' }), COPY.asrFailed);
  assert.equal(getAsrFailureMessage('raw'), COPY.asrFailed);
  assert.equal(getAsrFailureMessage(null), COPY.asrFailed);
});

test('keeps HUD copy in Portuguese', () => {
  for (const [key, value] of Object.entries(COPY)) {
    assert.equal(typeof value, 'string', key);
    assert.ok(value.trim().length > 0, key);
  }
  assert.match(COPY.title, /Óculos Rokid/);
  assert.match(COPY.greeting, /português/);
  assert.match(COPY.speakHint, /português brasileiro/);
});

const inkSource = readFileSync(
  new URL('../samples/pt-br/pages/index/index.ink', import.meta.url),
  'utf8',
);

test('the voice loop pins ASR and TTS to the target locale', () => {
  assert.match(inkSource, /recognition\.lang = TARGET_LOCALE/);
  assert.match(inkSource, /utterance\.lang = TARGET_LOCALE/);
});

test('the voice loop starts listening on load and guards unload', () => {
  assert.match(inkSource, /this\.initializing = false;[\s\S]*this\.startTalk\(\);/);
  assert.match(inkSource, /this\.pageActive = false/);
});

test('the voice loop routes ASR failures through the localized map', () => {
  assert.match(inkSource, /getAsrFailureMessage\(/);
});

test('TTS is dispatched immediately rather than queued', () => {
  assert.match(inkSource, /speechSynthesis\.speak\(utterance, 'immediate'\)/);
});
