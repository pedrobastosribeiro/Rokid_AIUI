import wx from 'wx';

import { getJsonReplyInstruction, parseTwoChannelReply } from './reply-format.js';
import { REMOTE_API_KEY, REMOTE_BASE_URL, REMOTE_MODEL } from './secrets.js';

// An OpenAI-compatible chat client, deliberately not a "Groq client". Base URL,
// model and key are all configuration, so pointing this at a gateway you own
// instead of at a provider directly is a config change rather than a code
// change.
//
// That distinction is the whole reason the shape is this way. Routing rules --
// which model handles which kind of question -- change often, and anything that
// lives in this bundle costs a Studio republish plus a device update every time
// it moves. The same rule on a gateway is a deploy. Talking to the provider
// directly is the right way to *test*; it is not where this should end up, for
// the additional reason that a provider key on the device is a key you cannot
// rotate without shipping a new build.
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

// Provisioning is the unsolved half. This writes the key; getting it here in the
// first place is the open question, and the answer should not be "hardcode it
// above" -- the packed `.aix` travels to Studio, so a key in the bundle is a
// published key. `samples/scanner` already reads QR codes through
// `BarcodeDetector`, which is the path worth building: show the token on a
// phone, look at it once, store it, never ship it.
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
  complete({ system, prompt, screenLimit }) {
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
      response_format: { type: 'json_object' },
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
            finish(reject, new Error(describeHttpFailure(status, res.data)));
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

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}
