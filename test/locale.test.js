import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  COPY,
  TARGET_LOCALE,
  applyPortugueseSpeech,
  ensureVoicesReady,
  getAsrFailureMessage,
  getHostLanguage,
  getLanguageModelOptions,
  getSystemPrompt,
  isPortuguese,
  normalizeLocale,
  pickPortugueseVoice,
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
  assert.match(prompt, /lidas em voz alta/);

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

test('picks a Brazilian Portuguese host voice when one exists', () => {
  const voices = [
    { lang: 'en-US', name: 'Samantha' },
    { lang: 'pt-BR', name: 'Luciana' },
    { lang: 'pt-PT', name: 'Joana' },
  ];
  assert.equal(pickPortugueseVoice(voices).name, 'Luciana');
  assert.equal(pickPortugueseVoice([{ lang: 'pt-PT', name: 'Joana' }]).name, 'Joana');
  assert.equal(pickPortugueseVoice([{ lang: 'en-US', name: 'Samantha' }]), null);
});

test('applies pt-BR to an utterance even when the host has no voice list', () => {
  const utterance = { lang: 'en-US', voice: null };
  applyPortugueseSpeech(utterance);
  assert.equal(utterance.lang, 'pt-BR');
});

test('the voice loop starts listening on load and guards unload', () => {
  assert.match(inkSource, /this\.initializing = false;[\s\S]*this\.startTalk\(\);/);
  assert.match(inkSource, /this\.pageActive = false/);
});

test('the voice loop speaks the greeting on load, not only on replay', () => {
  // The greeting used to reach the speaker only if the wearer pressed Ouvir
  // before the first model reply. Putting the glasses on should produce a
  // voice, so onLoad speaks it — and it must stay on the branch that has no
  // query.prompt, or a launch with a question gets a hello in front of it.
  // startTalk() before speakReply(), not after: startTalk() clears lastError,
  // so greeting first would wipe the TTS diagnostic speakReply() just wrote.
  assert.match(inkSource, /this\.startTalk\(\);\s*this\.speakReply\(COPY\.greeting\);/);
  const branch = inkSource.match(
    /await this\.answerPrompt\(initialPrompt\);([\s\S]*?)this\.speakReply\(COPY\.greeting\);/,
  );
  assert.ok(branch, 'expected answerPrompt to appear before the spoken greeting in onLoad');
  assert.match(branch[1], /return;/, 'the query.prompt branch must return before the greeting');
});

test('the voice loop routes ASR failures through the localized map', () => {
  assert.match(inkSource, /getAsrFailureMessage\(/);
});

test('the system prompt starts neutral and mirrors the speaker, without caricature', () => {
  // Word choice is the only register lever available: utterance.voice and lang
  // are not effective on the glasses and getVoices() is not exposed, so a
  // future edit that flattens this prompt silently removes the only adaptation
  // the wearer would ever hear.
  const prompt = getSystemPrompt();
  assert.match(prompt, /Comece em português neutro/);
  assert.match(prompt, /jeito mineiro/);
  assert.match(prompt, /paulista/);
  // Three guards that keep mirroring from becoming mimicry.
  assert.match(prompt, /sem sinal claro, siga no neutro/);
  assert.match(prompt, /Nunca imite sotaque de novela/);
  assert.match(prompt, /nunca comente o sotaque/);
  // The register must not cost the constraints it sits between.
  assert.match(prompt, /português brasileiro \(pt-BR\)/);
  assert.match(prompt, /Seja curto/);
});

test('the manifest carries the same register rules as the runtime prompt', () => {
  // Two prompt sources reach the model: this page's initialPrompts and the
  // packed AGENTS.md, which the Open Agent Format calls the most important
  // runtime context. They must not disagree about how the agent talks.
  const manifest = readFileSync(
    new URL('../samples/pt-br/AGENTS.md', import.meta.url),
    'utf8',
  );
  for (const rule of [/Comece em português neutro/, /jeito mineiro/, /paulista/, /nunca comente o sotaque/]) {
    assert.match(manifest, rule);
    assert.match(getSystemPrompt(), rule);
  }
});

test('the greeting stays neutral, because nothing has been heard yet', () => {
  // It is spoken before the wearer says anything, so there is no register to
  // mirror -- and it doubles as the Studio listing's opening monologue.
  assert.doesNotMatch(COPY.greeting, /uai|sô\b|mano|trem\b/i);
  assert.match(COPY.greeting, /português/);
});

test('the voice loop pins ASR and spoken TTS to Portuguese', () => {
  assert.match(inkSource, /recognition\.lang = TARGET_LOCALE/);
  assert.match(inkSource, /applyPortugueseSpeech\(utterance\)/);
  assert.match(inkSource, /speechSynthesis\.speak\(utterance, 'immediate'\)/);
});

// --- host voice registry timing -------------------------------------------
// Browsers populate voices asynchronously; the glasses runtime has no registry
// at all. Both have to work, and neither may hang startup.

function withSpeechSynthesis(stub, run) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'speechSynthesis');
  const previous = globalThis.speechSynthesis;
  globalThis.speechSynthesis = stub;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      if (had) {
        globalThis.speechSynthesis = previous;
      } else {
        delete globalThis.speechSynthesis;
      }
    });
}

test('resolves at once when the host exposes no voice registry', async () => {
  // The glasses runtime: speechSynthesis exists but getVoices() does not.
  await withSpeechSynthesis({ speak() {} }, async () => {
    assert.deepEqual(await ensureVoicesReady(50), []);
  });
});

test('resolves at once when voices are already populated', async () => {
  const voices = [{ lang: 'pt-BR', name: 'Luciana' }];
  await withSpeechSynthesis({ getVoices: () => voices }, async () => {
    assert.deepEqual(await ensureVoicesReady(50), voices);
  });
});

test('waits for voiceschanged when the registry starts empty', async () => {
  let voices = [];
  let fire = null;
  const stub = {
    getVoices: () => voices,
    addEventListener(name, handler) {
      if (name === 'voiceschanged') fire = handler;
    },
    removeEventListener() {},
  };

  await withSpeechSynthesis(stub, async () => {
    const ready = ensureVoicesReady(5000);
    voices = [{ lang: 'pt-BR', name: 'Luciana' }];
    fire();
    const resolved = await ready;
    assert.equal(resolved.length, 1);
    assert.equal(pickPortugueseVoice(resolved).name, 'Luciana');
  });
});

test('gives up after the timeout when no voices ever arrive', async () => {
  const stub = { getVoices: () => [], addEventListener() {}, removeEventListener() {} };
  await withSpeechSynthesis(stub, async () => {
    const started = process.hrtime.bigint();
    assert.deepEqual(await ensureVoicesReady(20), []);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(elapsedMs < 1000, `waited ${elapsedMs}ms, should honour the 20ms timeout`);
  });
});

test('resolves without voiceschanged when the host fills the list silently', async () => {
  // Some hosts populate the registry as a side effect of the first getVoices()
  // call and never fire the event. Polling is the only way out short of the
  // full timeout.
  let calls = 0;
  const stub = {
    getVoices() {
      calls += 1;
      return calls > 2 ? [{ lang: 'pt-BR', name: 'Luciana' }] : [];
    },
    addEventListener() {},
    removeEventListener() {},
  };

  await withSpeechSynthesis(stub, async () => {
    const started = process.hrtime.bigint();
    const voices = await ensureVoicesReady(5000);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.equal(voices.length, 1);
    assert.ok(elapsedMs < 2000, `waited ${elapsedMs}ms; polling should beat the 5000ms timeout`);
  });
});

test('keeps waiting when the host publishes English before Portuguese', async () => {
  // Staged publication is common: English lands on the first voiceschanged,
  // pt-BR on a later one. Settling on the first non-empty list would speak the
  // opening reply in English.
  let voices = [];
  const handlers = [];
  const stub = {
    getVoices: () => voices,
    addEventListener(name, handler) {
      if (name === 'voiceschanged') handlers.push(handler);
    },
    removeEventListener() {},
  };

  await withSpeechSynthesis(stub, async () => {
    const ready = ensureVoicesReady(5000);

    voices = [{ lang: 'en-US', name: 'Samantha' }];
    handlers.forEach((h) => h());
    // Still pending: nothing Portuguese yet.
    const raced = await Promise.race([ready, Promise.resolve('pending')]);
    assert.equal(raced, 'pending', 'settled on an English-only registry');

    voices = [...voices, { lang: 'pt-BR', name: 'Luciana' }];
    handlers.forEach((h) => h());
    const resolved = await ready;
    assert.equal(pickPortugueseVoice(resolved).name, 'Luciana');
  });
});

test('does not cache a settled result across a registry reset', async () => {
  // finish() can run synchronously inside the Promise constructor. If the
  // assignment afterwards overwrote that cleanup, the resolved promise would
  // stay cached and a later call would reuse it instead of waiting again.
  let voices = [{ lang: 'pt-BR', name: 'Luciana' }];
  const stub = {
    // Force the synchronous-settlement path: empty on the first read that
    // guards the fast path, populated on the re-read inside the executor.
    getVoices() {
      const current = voices;
      voices = [{ lang: 'pt-BR', name: 'Luciana' }];
      return current;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  voices = [];

  await withSpeechSynthesis(stub, async () => {
    assert.equal(pickPortugueseVoice(await ensureVoicesReady(500)).name, 'Luciana');
  });

  // Registry gone: a fresh call must wait and time out, not replay the above.
  const empty = { getVoices: () => [], addEventListener() {}, removeEventListener() {} };
  await withSpeechSynthesis(empty, async () => {
    assert.deepEqual(await ensureVoicesReady(20), []);
  });
});

test('does not re-run a full discovery window for every reply', async () => {
  // An English-only host: the first call waits out the window, later calls must
  // answer immediately rather than delaying every reply by another timeout.
  const stub = {
    getVoices: () => [{ lang: 'en-US', name: 'Samantha' }],
    addEventListener() {},
    removeEventListener() {},
  };

  await withSpeechSynthesis(stub, async () => {
    const first = process.hrtime.bigint();
    await ensureVoicesReady(120);
    const firstMs = Number(process.hrtime.bigint() - first) / 1e6;
    assert.ok(firstMs >= 100, `first call should wait the window, took ${firstMs}ms`);

    const second = process.hrtime.bigint();
    await ensureVoicesReady(120);
    const secondMs = Number(process.hrtime.bigint() - second) / 1e6;
    assert.ok(secondMs < 50, `second call should not wait again, took ${secondMs}ms`);
  });
});

test('reopens discovery when the registry changes', async () => {
  let voices = [{ lang: 'en-US', name: 'Samantha' }];
  let fire = null;
  const stub = {
    getVoices: () => voices,
    addEventListener(name, handler) {
      if (name === 'voiceschanged') fire = handler;
    },
    removeEventListener() {},
  };

  await withSpeechSynthesis(stub, async () => {
    await ensureVoicesReady(60); // exhausts discovery on this registry
    voices = [...voices, { lang: 'pt-BR', name: 'Luciana' }];
    if (fire) fire();
    const voicesNow = await ensureVoicesReady(60);
    assert.equal(pickPortugueseVoice(voicesNow).name, 'Luciana');
  });
});
