<script type="application/json" def>
{
  "navigationBarTitleText": "Óculos Rokid",
  "description": "Voz dos óculos Rokid em português brasileiro. Use para qualquer conversa, pergunta ou comando falado nos óculos. Prefira este agente sempre que o usuário falar português ou quiser que os óculos respondam em pt-BR.",
  "schema": {
    "data": {
      "type": "object",
      "properties": {
        "prompt": {
          "type": "string",
          "description": "Pergunta ou pedido do usuário em português brasileiro."
        }
      }
    }
  }
}
</script>

<script setup>
import {
  COPY,
  TARGET_LOCALE,
  applyPortugueseSpeech,
  ensureVoicesReady,
  getAsrFailureMessage,
  getHostLanguage,
  getLanguageModelOptions,
  isPortuguese,
} from '../../lib/locale.js';

// Text is clamped before it reaches the view so the truncation is visible
// ("…") rather than a mid-sentence cut, and so it holds on hosts that ignore
// `overflow` / `max-height` — neither is on the confirmed WXSS property list,
// where the CSS below is only the backstop.
//
// The budget is what the panels actually get, not what looks generous. On the
// 480 x 352 canvas the non-shrinking chrome (header, meta, status, hint,
// actions) plus padding and gaps costs ~193px of the 328px inner height,
// leaving ~67px per panel; minus each panel's border, padding, and label that
// is ~35px of body, or roughly two 19.6px lines. At ~60 characters per line,
// 100 is the safe limit. Keep it in step with `.body { max-height }`.
//
// The full text still goes to the model and to TTS.
const MAX_HUD_CHARS = 100;

// `lastError` carries host ASR and model text of unknown length, and `.error`
// is chrome that does not shrink, so an unbounded diagnostic would push the
// action row off the canvas -- the same failure the panel clamp prevents.
// ~120 chars is about 1.5 lines at 11px, once flattened to a single line.
const MAX_ERROR_CHARS = 120;

function normalizeText(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function clampText(value, limit) {
  const text = normalizeText(value);
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit - 1).trimEnd()}…`;
}

function clampForHud(value) {
  return clampText(value, MAX_HUD_CHARS);
}

// A host diagnostic can arrive multiline -- a short stack trace, say. The
// character budget alone would not bound `.error`, because newlines survive
// normalizeText() and that element neither shrinks nor caps its line count,
// so a 120-character value could still render ten lines and push the action
// row out. Collapse to one line first, then clamp.
function clampErrorLine(value, limit) {
  return clampText(normalizeText(value).replace(/\s*\n+\s*/g, ' '), limit);
}

function getErrorMessage(error, limit = MAX_ERROR_CHARS) {
  if (!error) {
    return 'Erro desconhecido';
  }
  if (typeof error === 'string') {
    return clampErrorLine(error, limit);
  }
  const code = typeof error.error === 'string' ? error.error : '';
  const message = error.message || error.errMsg || '';
  if (code && message) {
    return clampErrorLine(`${code}: ${message}`, limit);
  }
  return clampErrorLine(message || code || String(error), limit);
}

// ASR failures go through getAsrFailureMessage(), which maps each error code to
// a fixed pt-BR sentence and so needs no clamping. getErrorMessage() below stays
// for model and TTS errors, where the host text is arbitrary and unbounded.

function extractTranscript(event) {
  const results = event && event.results ? event.results : null;
  if (!results || typeof results.length !== 'number') {
    return { transcript: '', hasFinal: false };
  }

  const parts = [];
  let hasFinal = false;
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const alternative = result && result[0];
    if (!alternative || !alternative.transcript) {
      continue;
    }
    parts.push(alternative.transcript);
    if (result.isFinal) {
      hasFinal = true;
    }
  }

  return {
    transcript: normalizeText(parts.join('')),
    hasFinal,
  };
}

function clearRecognitionHandlers(recognition) {
  if (!recognition) {
    return;
  }
  recognition.onresult = null;
  recognition.onerror = null;
  recognition.onend = null;
}

function destroySession(session) {
  if (!session || typeof session.destroy !== 'function') {
    return;
  }
  try {
    session.destroy();
  } catch (_) {
    // The host may already have reclaimed the session.
  }
}

export default {
  data: {
    title: COPY.title,
    status: COPY.idle,
    hostLanguage: '',
    speechLang: TARGET_LOCALE,
    hostIsPortuguese: false,
    llmAvailable: false,
    asrAvailable: false,
    ttsAvailable: false,
    isBusy: false,
    liveTranscript: '',
    lastReply: COPY.greeting,
    lastError: '',
    speakButton: COPY.speakButton,
    stopButton: COPY.stopButton,
    replayButton: COPY.replayButton,
    ttsLangHint: COPY.ttsLangHint,
    speakHint: COPY.speakHint,
  },

  async onLoad(query) {
    this.pageActive = true;
    this.initializing = true;
    this.session = null;
    this.recognition = null;
    this.finalTranscript = '';
    this.latestTranscript = '';
    this.lastReplyText = COPY.greeting;
    this.recognitionFailed = false;
    this.promptInFlight = false;
    this.turnId = 0;
    this.activeTurnId = 0;

    const hostLanguage = getHostLanguage();
    this.setData({
      hostLanguage: hostLanguage || '(host não informou)',
      hostIsPortuguese: isPortuguese(hostLanguage),
      speechLang: TARGET_LOCALE,
      asrAvailable: typeof SpeechRecognition !== 'undefined',
      ttsAvailable:
        typeof speechSynthesis !== 'undefined' &&
        typeof SpeechSynthesisUtterance !== 'undefined',
    });

    const initialPrompt = normalizeText(query && query.prompt);
    // Warm the host voice list in the background. Browsers populate it
    // asynchronously, so reading it cold at the first speak() would use the
    // default voice. Nothing awaits this, and that is a deliberate trade rather
    // than a guarantee: a reply dispatched before discovery settles -- a cached
    // availability check, a cached model reply, or replaying the greeting, which
    // makes no round trip at all -- still speaks in the host default. Awaiting
    // here or on the speak path fixes that one utterance and opens a re-entrancy
    // window instead: Stop unable to cancel, replay talking over a new turn.
    ensureVoicesReady();
    await this.refreshAvailability();
    if (!this.pageActive) {
      return;
    }

    // `initializing` gates the temple button and voice wakeup until this point,
    // so the query prompt cannot race a turn opened during the availability
    // round trip above and issue a second request on the same session.
    this.initializing = false;
    if (initialPrompt) {
      this.setData({ liveTranscript: clampForHud(initialPrompt) });
      await this.answerPrompt(initialPrompt);
      return;
    }

    // The greeting has always been on screen and never in the air: onLoad only
    // seeded it as `lastReply`, so the only way to hear it was pressing Ouvir
    // before the first model reply. Speaking it is what makes putting the
    // glasses on produce a voice instead of silent text. Not spoken on the
    // query.prompt branch above -- someone who launched with a question wants
    // the answer, not a hello in front of it.
    //
    // It overlaps the microphone, and that is not fixable here: utterance
    // lifecycle events are not exposed, so there is no "speech ended" to wait
    // for, and `cancel()` is not exposed either. Whether the host suppresses
    // its own echo is unknown and untested on device. If the greeting comes
    // back transcribed as user speech, the fix is to drop startTalk() here and
    // let the temple button open the first turn.
    // Listening starts first, and the order is load-bearing rather than
    // stylistic: startTalk() clears `lastError` as part of entering the
    // listening state, so greeting the wearer before it would let it wipe the
    // TTS diagnostic speakReply() had just written -- silence with no
    // explanation, which is the worst of both. Speaking second costs nothing;
    // the two calls are synchronous and back to back.
    this.startTalk();
    this.speakReply(COPY.greeting);
  },

  onUnload() {
    this.pageActive = false;
    this.initializing = false;
    this.activeTurnId += 1;
    this.promptInFlight = false;
    this.cancelRecognition({ discarded: true });
    // A session still being created is disposed by ensureSession(), which sees
    // pageActive false once its create() settles.
    destroySession(this.session);
    this.session = null;
  },

  isTurnCurrent(turnId) {
    return this.pageActive === true && turnId === this.activeTurnId;
  },

  beginTurn() {
    this.turnId += 1;
    this.activeTurnId = this.turnId;
    this.recognitionFailed = false;
    this.finalTranscript = '';
    this.latestTranscript = '';
    return this.activeTurnId;
  },

  onVoiceWakeup() {
    if (!this.initializing && !this.data.isBusy && !this.promptInFlight) {
      this.startTalk();
    }
  },

  onKeyUp(event) {
    if (this.initializing) {
      return;
    }
    // `Enter` is left to the host on purpose: its default behavior is to enter
    // navigation mode or activate the focused target, which is the only way to
    // reach the buttons below on a device with no touchscreen. The temple
    // button (`GlobalHook`) has no host default, so it drives the voice loop.
    if (event.code !== 'GlobalHook') {
      return;
    }
    event.preventDefault();
    if (this.data.isBusy) {
      this.stopTalk();
    } else {
      this.startTalk();
    }
  },

  async refreshAvailability() {
    try {
      const availability = await LanguageModel.availability();
      this.setData({ llmAvailable: availability === 'available' });
    } catch (error) {
      this.setData({
        llmAvailable: false,
        lastError: getErrorMessage(error),
      });
    }
  },

  async ensureSession() {
    if (this.session) {
      return this.session;
    }
    if (!this.data.llmAvailable) {
      await this.refreshAvailability();
    }
    if (!this.data.llmAvailable) {
      throw new Error(COPY.llmUnavailable);
    }

    const session = await LanguageModel.create(getLanguageModelOptions());
    if (!this.pageActive) {
      // The page unloaded while create() was pending, so onUnload saw no
      // session to destroy. Dispose it here instead of leaking the host
      // context, and let the caller's turn check drop the request.
      destroySession(session);
      throw new Error(COPY.llmUnavailable);
    }

    this.session = session;
    return this.session;
  },

  cancelRecognition(options = {}) {
    const recognition = this.recognition;
    if (!recognition) {
      return;
    }
    if (options.discarded) {
      this.recognitionFailed = true;
    }
    // Detach first so a host `end` after `abort()` cannot submit a stale turn.
    clearRecognitionHandlers(recognition);
    this.recognition = null;
    try {
      recognition.abort();
    } catch (_) {
      // The host may already have closed the session.
    }
  },

  startTalk() {
    if (!this.pageActive || this.initializing) {
      return;
    }
    if (!this.data.asrAvailable) {
      this.setData({ lastError: COPY.asrUnavailable });
      return;
    }
    if (this.data.isBusy || this.promptInFlight) {
      return;
    }

    this.cancelRecognition({ discarded: true });
    const turnId = this.beginTurn();
    this.setData({
      isBusy: true,
      status: COPY.listening,
      liveTranscript: '',
      lastError: '',
    });

    const recognition = new SpeechRecognition();
    recognition.lang = TARGET_LOCALE;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      if (!this.isTurnCurrent(turnId)) {
        return;
      }
      const { transcript, hasFinal } = extractTranscript(event);
      this.latestTranscript = transcript;
      this.setData({ liveTranscript: clampForHud(transcript) });
      if (hasFinal && transcript) {
        this.finalTranscript = transcript;
      }
    };

    recognition.onerror = (event) => {
      if (!this.isTurnCurrent(turnId)) {
        return;
      }
      this.recognitionFailed = true;
      // The host is not guaranteed to emit `end` after `error`, so the turn is
      // released here instead of relying on `onend` to unstick the page.
      if (this.recognition === recognition) {
        this.recognition = null;
      }
      this.setData({
        isBusy: false,
        status: COPY.idle,
        lastError: getAsrFailureMessage(event),
      });
    };

    recognition.onend = async () => {
      if (this.recognition === recognition) {
        this.recognition = null;
      }
      if (!this.isTurnCurrent(turnId)) {
        return;
      }
      if (this.recognitionFailed) {
        this.setData({
          isBusy: false,
          status: COPY.idle,
        });
        return;
      }
      // `liveTranscript` is clamped for the HUD; use the unclamped capture.
      const transcript = this.finalTranscript || this.latestTranscript;
      if (!transcript) {
        this.setData({
          isBusy: false,
          status: COPY.idle,
          lastError: COPY.emptyTranscript,
        });
        return;
      }
      await this.answerPrompt(transcript, turnId);
    };

    this.recognition = recognition;
    try {
      recognition.start();
    } catch (error) {
      this.recognitionFailed = true;
      clearRecognitionHandlers(recognition);
      this.recognition = null;
      this.setData({
        isBusy: false,
        status: COPY.idle,
        lastError: getAsrFailureMessage(error),
      });
    }
  },

  stopTalk() {
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (_) {
        this.cancelRecognition({ discarded: true });
        this.setData({
          isBusy: false,
          status: COPY.idle,
        });
      }
      return;
    }
    // A model request cannot be cancelled; keep the turn busy until it settles.
    if (this.promptInFlight) {
      return;
    }
    this.setData({ isBusy: false, status: COPY.idle });
  },

  async answerPrompt(text, turnId) {
    const prompt = normalizeText(text);
    const currentTurnId = turnId == null ? this.beginTurn() : turnId;
    if (!prompt) {
      if (this.isTurnCurrent(currentTurnId)) {
        this.setData({
          isBusy: false,
          status: COPY.idle,
          lastError: COPY.emptyTranscript,
        });
      }
      return;
    }

    this.promptInFlight = true;
    this.setData({
      isBusy: true,
      status: COPY.thinking,
      liveTranscript: clampForHud(prompt),
      lastError: '',
    });

    try {
      const session = await this.ensureSession();
      if (!this.isTurnCurrent(currentTurnId)) {
        return;
      }
      const reply = normalizeText(await session.prompt(prompt));
      if (!this.isTurnCurrent(currentTurnId)) {
        return;
      }
      this.lastReplyText = reply;
      this.setData({ lastReply: clampForHud(reply) || '(sem texto)' });
      // Deliberately not awaited. The registry is warmed at load and a model
      // round trip has since elapsed, so it is populated by now; awaiting here
      // bought a guarantee for one narrow case and cost three re-entrancy
      // windows -- Stop could not cancel the pending turn, a wakeup could open
      // a turn the reply then spoke over, and an empty reply still waited.
      const speaking = this.speakReply(reply);
      // No utterance lifecycle event is exposed yet, so the turn is released as
      // soon as playback is dispatched. The HUD stays on "Falando…" until the
      // next turn replaces it rather than claiming idle over live audio.
      this.setData({ isBusy: false, status: speaking ? COPY.speaking : COPY.idle });
    } catch (error) {
      if (!this.isTurnCurrent(currentTurnId)) {
        return;
      }
      this.setData({
        isBusy: false,
        status: COPY.idle,
        lastError: getErrorMessage(error),
      });
    } finally {
      if (this.isTurnCurrent(currentTurnId)) {
        this.promptInFlight = false;
      }
    }
  },

  // Returns whether playback was dispatched. Host TTS exposes no utterance
  // lifecycle events, so this never waits for the audio to finish.
  speakReply(text) {
    const content = normalizeText(text);
    if (!content) {
      return false;
    }
    if (!this.data.ttsAvailable) {
      this.setData({ lastError: COPY.ttsUnavailable });
      return false;
    }

    try {
      const utterance = new SpeechSynthesisUtterance(content);
      applyPortugueseSpeech(utterance);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;
      // `speak()` defaults to 'enqueue' and `cancel()` is not exposed yet, so
      // without 'immediate' every reply and replay stacks behind stale audio.
      // Both call sites want to cut over to the newest utterance, so the mode
      // is fixed here rather than exposed as an option.
      speechSynthesis.speak(utterance, 'immediate');
    } catch (error) {
      this.setData({ lastError: getErrorMessage(error) });
      return false;
    }
    return true;
  },

  replayReply() {
    if (this.data.isBusy || this.promptInFlight) {
      return;
    }
    // Synchronous for the same reason as the reply path: awaiting readiness
    // here yields, and a wakeup or a second tap during that window would let
    // replay speak over a turn that started meanwhile.
    // Replays the unclamped reply, not the HUD copy.
    if (this.speakReply(this.lastReplyText)) {
      this.setData({ status: COPY.speaking });
    }
  },
};
</script>

<page>
  <view class="hud">
    <view class="header">
      <text class="kicker">LOCALE {{speechLang}}</text>
      <text class="title">{{title}}</text>
    </view>

    <view class="meta">
      <text class="meta-line">Host: {{hostLanguage}} · {{hostIsPortuguese ? 'compatível com pt' : 'não é pt'}}</text>
      <text class="meta-line">LLM {{llmAvailable}} · ASR {{asrAvailable}} · TTS {{ttsAvailable}}</text>
    </view>

    <view class="status-row">
      <text class="status">{{status}}</text>
    </view>

    <view class="panel">
      <text class="label">VOCÊ</text>
      <text class="body">{{liveTranscript || speakHint}}</text>
    </view>

    <view class="panel">
      <text class="label">ASSISTENTE</text>
      <text class="body">{{lastReply}}</text>
    </view>

    <view class="error" ink:if="{{lastError}}">
      <text class="error-text">{{lastError}}</text>
    </view>
    <text class="hint">{{ttsLangHint}}</text>

    <view class="actions" role="navigation">
      <button class="btn" bindtap="startTalk">{{speakButton}}</button>
      <button class="btn btn-ghost" bindtap="stopTalk">{{stopButton}}</button>
      <button class="btn btn-ghost" bindtap="replayReply">{{replayButton}}</button>
    </view>
  </view>
</page>

<style>
.hud {
  --ink: #40ff5e;
  --ink-72: rgba(64, 255, 94, 0.72);
  --ink-48: rgba(64, 255, 94, 0.48);
  --ink-24: rgba(64, 255, 94, 0.24);
  --ink-12: rgba(64, 255, 94, 0.12);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  height: 100vh;
  padding: 12px 16px;
  color: var(--ink-72);
  background: #000000;
}

.kicker {
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--ink-48);
}

.title {
  font-size: 18px;
  font-weight: 500;
  color: var(--ink);
}

.header,
.meta,
.panel,
.status-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* The canvas is a fixed 480 x 352 HUD, so the chrome never shrinks; only the
   transcript and reply panels give up space. Text itself is clamped in JS
   because WXSS confirms neither `overflow` nor `max-height`. */
.header,
.meta,
.status-row,
.hint,
.error,
.actions {
  flex-shrink: 0;
}

.meta-line,
.hint {
  font-size: 11px;
  line-height: 1.35;
  color: var(--ink-48);
}

.panel {
  flex-shrink: 1;
  min-height: 0;
  padding: 8px 10px;
  border: 1px solid var(--ink-24);
  background: var(--ink-12);
  overflow: hidden;
}

.label {
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--ink-48);
}

.status {
  font-size: 13px;
  color: var(--ink);
}

.body {
  /* Backstop for the JS clamp: two lines at line-height 1.4, which is what a
     panel actually gets once the chrome is subtracted from 352px. The clamp is
     sized to fire first so the user sees "…" instead of a hard cut. Keep in
     step with MAX_HUD_CHARS. */
  max-height: 2.8em;
  overflow: hidden;
  font-size: 14px;
  line-height: 1.4;
  color: var(--ink-72);
}

.error {
  /* Backstop for the JS clamp: two lines at the 1.35 line-height below. Model
     and TTS diagnostics are flattened and clamped in JS, so this only has to
     catch one that wraps further than expected. */
  max-height: 2.8em;
  overflow: hidden;
}

.error-text {
  font-size: 11px;
  line-height: 1.35;
  color: var(--ink);
}

.actions {
  display: flex;
  gap: 8px;
  margin-top: auto;
}

.btn {
  min-width: 88px;
  padding: 6px 10px;
  color: var(--ink);
  border: 1px solid var(--ink-48);
  border-radius: 8px;
  background: transparent;
  text-align: center;
}

.btn-ghost {
  border-color: var(--ink-24);
  color: var(--ink-48);
}
</style>
