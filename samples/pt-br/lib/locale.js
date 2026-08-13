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

// Resolves with the host voices once they exist, or once the timeout expires.
// Call it during startup so the wait overlaps work that is already happening
// and no utterance is ever delayed by it. Cheap to call repeatedly: it returns
// immediately once voices are present, and a host with no voice list at all
// (the glasses runtime) resolves on the spot with an empty list.
export function ensureVoicesReady(timeoutMs = VOICES_READY_TIMEOUT_MS) {
  const present = listHostVoices();
  if (present.length || !speechSynthesisApi()) {
    return Promise.resolve(present);
  }
  if (pendingVoices) {
    return pendingVoices;
  }

  const api = speechSynthesisApi();
  pendingVoices = new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      // Drop the timer when the event wins, so it does not sit pending.
      if (timer !== null) {
        clearTimeout(timer);
      }
      try {
        if (typeof api.removeEventListener === 'function') {
          api.removeEventListener('voiceschanged', finish);
        }
      } catch (_) {
        // Nothing to detach.
      }
      // Only ever a handle on a wait in flight, so that concurrent callers
      // share one. Clearing it here means a populated registry is answered by
      // the fast path above, and timing out empty is not cached as a permanent
      // "this host has no voices".
      pendingVoices = null;
      resolve(listHostVoices());
    };

    try {
      if (typeof api.addEventListener === 'function') {
        api.addEventListener('voiceschanged', finish);
      }
    } catch (_) {
      // No event support; the timeout is the only path out.
    }
    timer = setTimeout(finish, timeoutMs);
  });

  return pendingVoices;
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
