export const TARGET_LOCALE = 'pt-BR';

export const COPY = {
  title: 'Óculos Rokid',
  greeting: 'Olá. Pode falar com os óculos em português.',
  idle: 'Pronto',
  listening: 'Ouvindo…',
  thinking: 'Pensando…',
  speaking: 'Falando…',
  emptyTranscript: 'Não reconheci a fala. Tente de novo.',
  llmUnavailable: 'O modelo de linguagem não está disponível neste runtime.',
  asrUnavailable: 'Reconhecimento de fala indisponível.',
  asrFailed: 'Falha no reconhecimento de fala. Tente de novo.',
  asrNoSpeech: 'Não ouvi nada. Tente de novo.',
  asrAborted: 'Reconhecimento interrompido. Tente de novo.',
  asrAudioCapture: 'Não consegui usar o microfone. Tente de novo.',
  asrNetwork: 'Falha de rede no reconhecimento. Tente de novo.',
  asrNotAllowed: 'Permissão de microfone negada. Tente de novo.',
  asrLanguage: 'Este runtime não reconhece pt-BR. Tente de novo.',
  ttsUnavailable: 'Síntese de voz indisponível. A resposta fica só em texto.',
  ttsLangHint:
    'Pedimos pt-BR; o host pode ignorar. No Craft, use Siri em português.',
  speakButton: 'Falar',
  stopButton: 'Parar',
  replayButton: 'Ouvir',
  speakHint: 'Fale em português brasileiro',
};

export function getHostLanguage() {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
      return navigator.language;
    }
  } catch (_) {
    // Some hosts expose navigator without language.
  }
  return '';
}

export function normalizeLocale(tag) {
  if (!tag || typeof tag !== 'string') {
    return '';
  }

  const [language, region] = tag.trim().replace(/_/g, '-').split('-');
  if (!language) {
    return '';
  }

  const lang = language.toLowerCase();
  const reg = region ? region.toUpperCase() : '';
  return reg ? `${lang}-${reg}` : lang;
}

export function isPortuguese(tag) {
  const normalized = normalizeLocale(tag);
  return normalized === 'pt' || normalized.startsWith('pt-');
}

export function getSystemPrompt() {
  return [
    'Você é a voz dos óculos Rokid.',
    'Você é a comunicação dos óculos, não um aplicativo à parte.',
    'Fale sempre em português brasileiro (pt-BR).',
    'Suas respostas serão lidas em voz alta: escreva frases naturais para falar, sem markdown nem URLs.',
    'Seja curto: o display é um HUD de 480×352 px.',
    'Não misture inglês ou chinês, salvo nomes próprios.',
    'Se não entender, peça para repetir em uma frase só.',
  ].join(' ');
}

export function getLanguageModelOptions() {
  return {
    initialPrompts: [
      {
        role: 'system',
        content: getSystemPrompt(),
      },
    ],
  };
}

export function isPortugueseVoice(voice) {
  if (!voice) {
    return false;
  }
  const lang = typeof voice.lang === 'string' ? voice.lang : '';
  const name = typeof voice.name === 'string' ? voice.name : '';
  return isPortuguese(lang) || /portugu|brazil|brasil|luciana|fernanda/i.test(name);
}

export function pickPortugueseVoice(voices) {
  const list = Array.isArray(voices) ? voices : [];
  const brazilian = list.find((voice) => normalizeLocale(voice.lang) === TARGET_LOCALE);
  if (brazilian) {
    return brazilian;
  }
  return list.find((voice) => isPortugueseVoice(voice)) || null;
}

// Browser hosts populate the voice registry asynchronously: the first
// getVoices() call returns an empty list and a `voiceschanged` event follows.
// Reading it once would therefore speak the first reply -- typically the
// query.prompt one dispatched during startup -- in the default voice, which is
// the exact outcome selecting a Portuguese voice exists to avoid.
const VOICES_READY_TIMEOUT_MS = 1000;
const VOICES_POLL_MS = 50;

function speechSynthesisApi() {
  try {
    if (
      typeof speechSynthesis !== 'undefined' &&
      typeof speechSynthesis.getVoices === 'function'
    ) {
      return speechSynthesis;
    }
  } catch (_) {
    // Glasses runtime does not expose getVoices().
  }
  return null;
}

function listHostVoices() {
  const api = speechSynthesisApi();
  if (!api) {
    return [];
  }
  try {
    const voices = api.getVoices();
    return Array.isArray(voices) ? voices : [];
  } catch (_) {
    return [];
  }
}

let pendingVoices = null;

// Resolves once a Portuguese voice is available, or once the timeout expires.
// Start it at load without awaiting, then await it immediately before speaking:
// by then it is all but always resolved, and the page never gates user input on
// it. Cheap to call repeatedly, and a host with no voice registry at all -- the
// glasses runtime -- resolves on the spot with an empty list.
export function ensureVoicesReady(timeoutMs = VOICES_READY_TIMEOUT_MS) {
  // Ready means a *Portuguese* voice exists, not merely some voice. Hosts
  // publish in stages -- English first, pt-BR on a later event is common --
  // and settling on the first non-empty list would speak the opening reply in
  // English, which is the whole thing this is here to prevent.
  if (pickPortugueseVoice(listHostVoices()) || !speechSynthesisApi()) {
    return Promise.resolve(listHostVoices());
  }
  if (pendingVoices) {
    return pendingVoices;
  }

  const api = speechSynthesisApi();
  let settled = false;
  const waiting = new Promise((resolve) => {
    let timer = null;
    let poll = null;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      // Drop both waits when whichever one wins, so neither sits pending.
      if (timer !== null) {
        clearTimeout(timer);
      }
      if (poll !== null) {
        clearTimeout(poll);
      }
      try {
        if (typeof api.removeEventListener === 'function') {
          api.removeEventListener('voiceschanged', onVoicesChanged);
        }
      } catch (_) {
        // Nothing to detach.
      }
      resolve(listHostVoices());
    };

    // Settle only once Portuguese is actually there. `voiceschanged` can fire
    // several times as the host fills the registry, so the handler checks
    // rather than assuming the first event is the last.
    const onVoicesChanged = () => {
      settleIfPortuguese();
    };
    const settleIfPortuguese = () => {
      if (pickPortugueseVoice(listHostVoices())) {
        finish();
        return true;
      }
      return false;
    };

    try {
      if (typeof api.addEventListener === 'function') {
        api.addEventListener('voiceschanged', onVoicesChanged);
      }
    } catch (_) {
      // No event support; the poll and timeout below are the only paths out.
    }

    // `voiceschanged` is not guaranteed. Some hosts fill the registry as a
    // side effect of the first getVoices() call and never fire it, and the
    // call at the top of this function may itself be what triggered that. So
    // re-read before committing to a wait, then poll -- otherwise those hosts
    // sit out the whole timeout with a Portuguese voice already available.
    if (settleIfPortuguese()) {
      return;
    }
    // A rescheduled setTimeout rather than setInterval: neither is in the
    // documented capability scope, but setTimeout is the one the official
    // create-aiui-agent template already relies on.
    const pollOnce = () => {
      if (settled || settleIfPortuguese()) {
        return;
      }
      poll = setTimeout(pollOnce, VOICES_POLL_MS);
    };
    poll = setTimeout(pollOnce, VOICES_POLL_MS);
    // The timeout settles regardless: no Portuguese voice is a valid outcome,
    // and `lang` still gets pinned.
    timer = setTimeout(finish, timeoutMs);
  });

  // `pendingVoices` is only ever a handle on a wait in flight, so concurrent
  // callers share one. It has to be decided *after* construction: finish() can
  // run synchronously inside the executor above, and assigning over that would
  // resurrect a settled promise as a permanent cache -- a later call would
  // then reuse a stale answer instead of waiting again.
  pendingVoices = settled ? null : waiting;
  waiting.then(() => {
    if (pendingVoices === waiting) {
      pendingVoices = null;
    }
  });

  return waiting;
}

export function applyPortugueseSpeech(utterance) {
  if (!utterance) {
    return utterance;
  }
  utterance.lang = TARGET_LOCALE;
  const voice = pickPortugueseVoice(listHostVoices());
  if (voice) {
    utterance.voice = voice;
  }
  return utterance;
}

function getErrorCode(error) {
  if (!error || typeof error === 'string') {
    return '';
  }
  return typeof error.error === 'string' ? error.error : '';
}

export function getAsrFailureMessage(error) {
  const code = getErrorCode(error);
  switch (code) {
    case 'no-speech':
      return COPY.asrNoSpeech;
    case 'aborted':
      return COPY.asrAborted;
    case 'audio-capture':
      return COPY.asrAudioCapture;
    case 'network':
      return COPY.asrNetwork;
    case 'not-allowed':
    case 'service-not-allowed':
      return COPY.asrNotAllowed;
    case 'language-not-supported':
      return COPY.asrLanguage;
    default:
      return COPY.asrFailed;
  }
}
