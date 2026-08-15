import wx from 'wx';

import { getJsonReplyInstruction, parseTwoChannelReply } from './reply-format.js';
import { REMOTE_API_KEY, REMOTE_BASE_URL, REMOTE_MODEL } from './secrets.js';

// An OpenAI-compatible chat client, deliberately not a "Groq client". Base URL,
// model and key are all configuration, so switching provider -- or putting a
// server of your own in front -- is a config change rather than a code change.
//
// Keeping that seam costs nothing and is worth having, because the two things
// most likely to change are exactly the two that live outside this file: which
// model answers, and where the key is held. What the sample actually does is
// call the provider directly, which is one hop and nothing to operate.
const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';

// Groq's free tier is 30 requests/minute and a few thousand tokens/minute
// shared across models, which is ample for glasses-length replies but not for
// long ones -- another reason the token cap below is small.
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

// The cap the provider actually enforces, as opposed to the prompt's budget,
// which it may ignore. Two pt-BR sentences plus the JSON wrapper sits well under
// this; the value is a runaway stop, not a target.
const DEFAULT_MAX_TOKENS = 220;

// `wx.request` documents no timeout option (see
// `documentation/3-api/weixin-compatible-apis/networking.md`), so the deadline
// is enforced here with the documented `RequestTask.abort()`. Without one a
// stalled connection leaves the HUD on "Pensando…" indefinitely, which on a
// device with no back button reads as a freeze.
const DEFAULT_TIMEOUT_MS = 12000;

// Storage is local to the device and isolated per agent
// (`documentation/3-api/storage-api.md`), which makes it the right home for a
// key but not a vault -- nothing documents it as encrypted. Use a key you can
// revoke, scoped to this one use.
const API_KEY_STORAGE_KEY = 'ptbr.remoteModel.apiKey';

export function readStoredApiKey() {
  try {
    const value = wx.getStorageSync(API_KEY_STORAGE_KEY);
    return typeof value === 'string' ? value.trim() : '';
  } catch (_) {
    // No storage in this host, or the key was never written.
    return '';
  }
}

// Storage wins over the pasted constant, and the order matters. Once a key has
// been provisioned onto a device it should keep working even if someone left a
// stale value in `secrets.js`, and a device that was provisioned properly should
// never silently fall back to a key that shipped in the bundle.
export function resolveApiKey() {
  return readStoredApiKey() || (REMOTE_API_KEY || '').trim();
}

// Writing the key here rather than leaving it in `secrets.js` is what keeps it
// out of the repository and out of the packed `.aix`, which travels to Studio.
// Call this once from a temporary line, remove the line, rebuild: storage
// survives the new build, so the key is on the device and in no commit.
export function storeApiKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  try {
    wx.setStorageSync(API_KEY_STORAGE_KEY, key);
    return true;
  } catch (_) {
    return false;
  }
}

function describeHttpFailure(statusCode, data) {
  if (statusCode === 401 || statusCode === 403) {
    return 'Chave da API recusada.';
  }
  if (statusCode === 429) {
    // Expected on a free tier under repeated questions, and worth naming rather
    // than folding into a generic failure: the fix is to wait, not to retry.
    return 'Limite de requisições atingido. Aguarde um instante.';
  }
  const detail =
    data && data.error && typeof data.error.message === 'string'
      ? data.error.message
      : '';
  return detail ? `Erro ${statusCode}: ${detail}` : `Erro ${statusCode} no modelo remoto.`;
}

export class RemoteModel {
  constructor(options = {}) {
    // Injected rather than read here, matching `samples/tts`: the client stays
    // usable without deciding where secrets live, and a caller can swap the
    // source without touching this file.
    this.getApiKey = options.getApiKey || resolveApiKey;
    this.baseUrl = options.baseUrl || REMOTE_BASE_URL || DEFAULT_BASE_URL;
    this.model = options.model || REMOTE_MODEL || DEFAULT_MODEL;
    this.maxTokens = options.maxTokens || DEFAULT_MAX_TOKENS;
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.task = null;
  }

  isConfigured() {
    try {
      return Boolean(this.getApiKey());
    } catch (_) {
      return false;
    }
  }

  // Aborts a request still in flight. The page calls this when a turn is
  // superseded; without it a stale reply can land after the wearer has moved on
  // and speak over the new one, which `speechSynthesis` cannot then cancel.
  abort() {
    if (!this.task) {
      return;
    }
    try {
      this.task.abort();
    } catch (_) {
      // Already finished.
    }
    this.task = null;
  }

  // Resolves to the `{ fala, tela, structured }` shape from reply-format.
  //
  // `response_format` is the one option here that not every OpenAI-compatible
  // endpoint implements, and an endpoint that does not usually rejects the whole
  // request rather than ignoring the field. Since the point of this client is
  // that you can aim it somewhere else, a 400 gets one retry without the option:
  // `parseTwoChannelReply` already degrades prose into a usable reply, so the
  // second attempt succeeds where the first could only fail confusingly.
  async complete({ system, prompt, screenLimit }) {
    try {
      return await this.send({ system, prompt, screenLimit, json: true });
    } catch (error) {
      if (!isUnsupportedFormat(error)) {
        throw error;
      }
      return this.send({ system, prompt, screenLimit, json: false });
    }
  }

  send({ system, prompt, screenLimit, json }) {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return Promise.reject(new Error('Modelo remoto sem chave configurada.'));
    }

    const body = {
      model: this.model,
      max_completion_tokens: this.maxTokens,
      // Low but not zero: this is a conversational voice, and greedy decoding
      // makes repeated questions produce word-for-word identical replies, which
      // sounds broken when spoken aloud.
      temperature: 0.3,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: `${system} ${getJsonReplyInstruction(screenLimit)}` },
        { role: 'user', content: prompt },
      ],
    };

    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;

      const finish = (fn, value) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer !== null) {
          clearTimeout(timer);
        }
        this.task = null;
        fn(value);
      };

      this.task = wx.request({
        url: `${this.baseUrl}/chat/completions`,
        method: 'POST',
        header: {
          'content-type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        data: body,
        success: (res) => {
          const status = res && res.statusCode;
          if (typeof status === 'number' && status >= 400) {
            const failure = new Error(describeHttpFailure(status, res.data));
            // Carried so the retry above can tell a rejected option from a
            // rejected key. Without it every 400 would look the same.
            failure.statusCode = status;
            failure.body = res.data;
            finish(reject, failure);
            return;
          }
          // `dataType` defaults to `json`, so `data` is usually parsed already;
          // a host that hands back a string still has to work.
          const payload =
            typeof res.data === 'string' ? safeJsonParse(res.data) : res.data;
          const content =
            payload &&
            payload.choices &&
            payload.choices[0] &&
            payload.choices[0].message &&
            payload.choices[0].message.content;
          if (!content) {
            finish(reject, new Error('Modelo remoto devolveu resposta vazia.'));
            return;
          }
          finish(resolve, parseTwoChannelReply(content));
        },
        fail: (res) => {
          const message = (res && res.errMsg) || 'Falha de rede no modelo remoto.';
          finish(reject, new Error(message));
        },
      });

      timer = setTimeout(() => {
        // Abort first: settling the promise without it leaves the socket open
        // and the callbacks still armed.
        this.abort();
        finish(reject, new Error('O modelo remoto demorou demais. Tente de novo.'));
      }, this.timeoutMs);
    });
  }
}

// Only a 400 is worth retrying without the option, and only when the endpoint
// says the option is what it disliked. A 400 about the model name or the message
// shape would fail identically on the second attempt, so retrying it would just
// double the wait before the same error reaches the wearer.
function isUnsupportedFormat(error) {
  if (!error || error.statusCode !== 400) {
    return false;
  }
  const body = error.body;
  const detail =
    typeof body === 'string'
      ? body
      : (body && body.error && body.error.message) || error.message || '';
  return /response_format|json_object|json mode/i.test(detail);
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}
