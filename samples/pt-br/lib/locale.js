export const TARGET_LOCALE = 'pt-BR';

export const COPY = {
  title: 'Assistente PT-BR',
  greeting: 'Olá. Fale comigo em português brasileiro.',
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
    'O runtime ainda pode ignorar utterance.lang. O prompt do modelo já força pt-BR.',
  speakButton: 'Falar',
  stopButton: 'Parar',
  replayButton: 'Ouvir',
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

export function getHostLanguages() {
  try {
    if (typeof navigator !== 'undefined' && Array.isArray(navigator.languages)) {
      return navigator.languages.filter((item) => typeof item === 'string');
    }
  } catch (_) {
    // Ignore hosts that do not expose a language list.
  }
  const primary = getHostLanguage();
  return primary ? [primary] : [];
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

export function getSpeechLang(preferred = TARGET_LOCALE) {
  return preferred || TARGET_LOCALE;
}

export function getSystemPrompt() {
  return [
    'Você é um assistente de voz nos óculos Rokid.',
    'Responda sempre em português brasileiro (pt-BR).',
    'Seja curto: o display é um HUD de 480×352 px.',
    'Evite markdown, listas longas e emojis excessivos.',
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
