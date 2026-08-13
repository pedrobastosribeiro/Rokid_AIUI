<script type="application/json" def>
{
  "navigationBarTitleText": "Assistente PT-BR",
  "description": "Assistente de voz em português brasileiro. Use quando o usuário falar português, pedir para conversar em português, ou quiser testar ASR, LLM e TTS em pt-BR.",
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
  getHostLanguage,
  getLanguageModelOptions,
  getSpeechLang,
  isPortuguese,
} from '../../lib/locale.js';

function normalizeText(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function getErrorMessage(error) {
  if (!error) {
    return 'Erro desconhecido';
  }
  if (typeof error === 'string') {
    return error;
  }
  const code = typeof error.error === 'string' ? error.error : '';
  const message = error.message || error.errMsg || '';
  if (code && message) {
    return `${code}: ${message}`;
  }
  return message || code || String(error);
}

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

export default {
  data: {
    title: COPY.title,
    status: COPY.idle,
    hostLanguage: '',
    speechLang: getSpeechLang(),
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
  },

  async onLoad(query) {
    this.pageActive = true;
    this.session = null;
    this.recognition = null;
    this.finalTranscript = '';
    this.recognitionFailed = false;
    this.promptInFlight = false;
    this.turnId = 0;
    this.activeTurnId = 0;

    const hostLanguage = getHostLanguage();
    this.setData({
      hostLanguage: hostLanguage || '(host não informou)',
      hostIsPortuguese: isPortuguese(hostLanguage),
      speechLang: getSpeechLang(),
      asrAvailable: typeof SpeechRecognition !== 'undefined',
      ttsAvailable:
        typeof speechSynthesis !== 'undefined' &&
        typeof SpeechSynthesisUtterance !== 'undefined',
    });

    await this.refreshAvailability();
    if (!this.pageActive) {
      return;
    }

    const initialPrompt = normalizeText(query && query.prompt);
    if (initialPrompt) {
      this.setData({ liveTranscript: initialPrompt });
      await this.answerPrompt(initialPrompt);
    }
  },

  onUnload() {
    this.pageActive = false;
    this.activeTurnId += 1;
    this.promptInFlight = false;
    this.cancelRecognition({ discarded: true });
    if (this.session && typeof this.session.destroy === 'function') {
      this.session.destroy();
    }
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
    return this.activeTurnId;
  },

  onVoiceWakeup() {
    if (!this.data.isBusy && !this.promptInFlight) {
      this.startTalk();
    }
  },

  onKeyUp(event) {
    if (event.code === 'Enter' || event.code === 'GlobalHook') {
      event.preventDefault();
      if (this.data.isBusy) {
        this.stopTalk();
      } else {
        this.startTalk();
      }
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
    this.session = await LanguageModel.create(getLanguageModelOptions());
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
    recognition.lang = getSpeechLang();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      if (!this.isTurnCurrent(turnId)) {
        return;
      }
      const { transcript, hasFinal } = extractTranscript(event);
      this.setData({ liveTranscript: transcript });
      if (hasFinal && transcript) {
        this.finalTranscript = transcript;
      }
    };

    recognition.onerror = (event) => {
      if (!this.isTurnCurrent(turnId)) {
        return;
      }
      this.recognitionFailed = true;
      this.setData({
        lastError: getErrorMessage(event) || 'Falha no reconhecimento de fala. Tente de novo.',
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
      const transcript = this.finalTranscript || normalizeText(this.data.liveTranscript);
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
        lastError: getErrorMessage(error),
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
      liveTranscript: prompt,
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
      this.setData({ lastReply: reply || '(sem texto)' });
      await this.speakReply(reply);
      if (!this.isTurnCurrent(currentTurnId)) {
        return;
      }
      this.setData({ isBusy: false, status: COPY.idle });
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

  async speakReply(text, options = {}) {
    const content = normalizeText(text);
    const restoreIdle = options.restoreIdle === true;
    const mode = options.mode === 'immediate' ? 'immediate' : 'enqueue';
    if (!content) {
      return;
    }
    if (!this.data.ttsAvailable) {
      this.setData({ lastError: COPY.ttsUnavailable });
      return;
    }

    this.setData({ status: COPY.speaking });
    try {
      const utterance = new SpeechSynthesisUtterance(content);
      utterance.lang = getSpeechLang();
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;
      // Host TTS does not expose utterance lifecycle events, so use an explicit
      // mode and return after dispatching the request.
      speechSynthesis.speak(utterance, mode);
    } catch (error) {
      this.setData({ lastError: getErrorMessage(error) });
    }
    if (restoreIdle) {
      this.setData({ status: COPY.idle });
    }
  },

  replayReply() {
    if (this.data.isBusy || this.promptInFlight) {
      return;
    }
    this.speakReply(this.data.lastReply, { restoreIdle: true, mode: 'immediate' });
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
      <text class="meta-line">Host: {{hostLanguage}}</text>
      <text class="meta-line">LLM {{llmAvailable}} · ASR {{asrAvailable}} · TTS {{ttsAvailable}}</text>
    </view>

    <view class="status-row">
      <text class="status">{{status}}</text>
    </view>

    <view class="panel">
      <text class="label">VOCÊ</text>
      <text class="body">{{liveTranscript || 'Toque em Falar ou aperte Enter'}}</text>
    </view>

    <view class="panel">
      <text class="label">ASSISTENTE</text>
      <text class="body">{{lastReply}}</text>
    </view>

    <text class="error" ink:if="{{lastError}}">{{lastError}}</text>
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

.meta,
.panel,
.status-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.meta-line,
.hint,
.error {
  font-size: 11px;
  line-height: 1.35;
  color: var(--ink-48);
}

.panel {
  padding: 8px 10px;
  border: 1px solid var(--ink-24);
  background: var(--ink-12);
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
  font-size: 14px;
  line-height: 1.4;
  color: var(--ink-72);
}

.error {
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
