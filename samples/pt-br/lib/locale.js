import { CONCISION_RULES } from './reply-format.js';

export const TARGET_LOCALE = 'pt-BR';

export const COPY = {
  title: 'Mav',
  // Spoken at load when the page opens with no query.prompt -- a launch that
  // already carries a question skips it and answers instead. So it is usually
  // the first thing the wearer hears, and it is deliberately neutral: the agent
  // has heard nothing yet, so it has no basis for a regional register. It picks
  // one up from the wearer's own words and only then adapts. Also the string
  // the Studio listing uses as its opening monologue, so the two stay in step.
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

// The model mirrors the wearer's regional register. Two limits shape how this
// is written, and both are worth knowing before editing it.
//
// It reads text, not audio. The model never hears the wearer -- it receives an
// ASR transcript, so pronunciation, the part people actually mean by "accent",
// is gone before it arrives. What survives is vocabulary, and only the part the
// recognizer chose not to normalize: a pt-BR ASR often writes "você" for "cê"
// and "não" for "num". So the signal is real but lossy, and the prompt asks for
// a default rather than a guess.
//
// And nothing here selects a voice. `utterance.voice` and `lang` are documented
// as not effective on the glasses and `getVoices()` is not exposed, so the reply
// is spoken in whatever voice the host has, in whatever accent that voice has,
// no matter which register the words are in. Matching the wearer phonetically
// would need a cloud TTS with a chosen voice, the way samples/tts reaches
// Minimax.
export function getSystemPrompt() {
  return [
    'Seu nome é Mav. Você é a voz dos óculos Rokid.',
    // Third name, and each rejection taught the constraint. "Óculos Rokid" was
    // the agent and the product at once, so asking for it by name got glasses
    // specifications instead of this agent, and pt-BR ASR heard "Rocket".
    // "Axiom" fixed the collision and lost to a different failure: it is a near
    // cognate, and the pipeline rendered it as "Axioma", the actual Portuguese
    // word. So the bar is higher than "not the hardware's name" -- the name must
    // also have nothing in pt-BR to be corrected *into*. "Mav" is short and is
    // not a word, which leaves nothing to normalize toward.
    'Você é a comunicação dos óculos, não um aplicativo à parte.',
    'Entenda o usuário em qualquer idioma, inclusive inglês, e responda SEMPRE em português brasileiro (pt-BR), mesmo quando a pergunta vier em outra língua. Nunca responda em inglês.',
    // The transcript arrives from a pt-BR recognizer, and `recognition.lang`
    // takes a single BCP 47 tag -- there is no multilingual or auto-detect mode
    // in the documented API. So English speech is not transcribed as English:
    // it comes through approximated into Portuguese spelling. Naming that for
    // the model is the only lever available, and it is a real one, because
    // recovering a phrase from its phonetic mangling is something a model does
    // well and a recognizer locked to one language cannot do at all.
    'O reconhecimento de fala é pt-BR, então frases em inglês chegam escritas com grafia aportuguesada e podem parecer sem sentido. Quando o texto parecer inglês mal transcrito, interprete como inglês e responda ao que a pessoa quis dizer, em português.',
    'Comece em português neutro, sem sotaque regional.',
    'Repare no jeito de falar do usuário e acompanhe: com "uai", "trem", "sô", "bão", responda no jeito mineiro; com "mano", "meu", "tipo", "daí", acompanhe o paulista; com outro jeito, acompanhe esse.',
    'Espelhe com moderação e só o que ouvir de fato; sem sinal claro, siga no neutro. Nunca imite sotaque de novela, e nunca comente o sotaque de quem fala.',
    'Suas respostas serão lidas em voz alta: escreva frases naturais para falar, sem markdown nem URLs.',
    ...CONCISION_RULES,
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
// A full discovery window that found nothing is worth remembering: without it,
// an English-only host re-runs the whole wait before every single reply. Held
// against the registry it was learned from, not globally -- a different
// speechSynthesis object has not been examined yet -- and any `voiceschanged`
// reopens it, so a voice that arrives late is still picked up.
let exhaustedFor = null;
let watchedApi = null;

function watchVoiceChanges(api) {
  if (watchedApi === api || typeof api.addEventListener !== 'function') {
    return;
  }
  watchedApi = api;
  try {
    api.addEventListener('voiceschanged', () => {
      exhaustedFor = null;
    });
  } catch (_) {
    // No event support: the window's outcome stands until the page reloads.
  }
}

// Resolves once a Portuguese voice is available, or once the timeout expires.
// Call it at load and do not await it anywhere: it exists to have the registry
// already populated by the time applyPortugueseSpeech() reads it, not to gate
// playback. That is best effort, not a guarantee -- a reply dispatched inside
// the discovery window still speaks in the host default. Awaiting it on the
// speak path would close that window but reopen a worse one, since every await
// added there let Stop and replay interleave with a turn already in flight.
// Cheap to call repeatedly, and a host with no voice registry at all -- the
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
  // Already waited a full window on this registry and found nothing. Waiting
  // again would delay every reply rather than only the first.
  if (exhaustedFor === speechSynthesisApi()) {
    return Promise.resolve(listHostVoices());
  }

  const api = speechSynthesisApi();
  watchVoiceChanges(api);
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
      const voices = listHostVoices();
      exhaustedFor = pickPortugueseVoice(voices) ? null : api;
      resolve(voices);
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

// Budgeted from the whole composed message, not from the suffix alone. `.error`
// is non-shrinking chrome whose height the page's 193px arithmetic never
// counted -- it is conditional, and it appears exactly when the panels are
// already full -- so a message that wraps to a second line takes that line from
// the panels below, on a renderer that then does not clip their text. The fixed
// sentence is ~46 characters, so this total keeps the pair on one line at 11px.
const MAX_ASR_MESSAGE_CHARS = 72;

// Flattened as well as truncated: a newline survives the character budget and
// still costs a rendered line in an element that neither shrinks nor caps its
// line count.
function boundCode(code, room) {
  const flat = String(code).replace(/\s+/g, ' ').trim();
  return flat.length <= room ? flat : `${flat.slice(0, Math.max(0, room - 1))}…`;
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
      // An unmapped code is the one case where the fixed sentence tells nobody
      // anything -- not the wearer, who cannot act on it either way, and not
      // whoever is debugging, who needs to know *which* failure this was before
      // it can be mapped. Appending the raw code costs a few characters and is
      // the difference between "speech recognition failed" and a lead.
      //
      // Bounded, because this is the only branch whose length the host controls.
      // The page renders this straight into `.error`, which is `flex-shrink: 0`
      // chrome -- an unbounded value there pushes the action row off a 352px
      // canvas that does not scroll, which is the failure this whole file is
      // careful about elsewhere. A real error code is a short token; anything
      // longer is not a code and is not worth the row it would cost.
      if (!code) {
        return COPY.asrFailed;
      }
      // Three characters for the space and the parentheses around the code.
      const room = MAX_ASR_MESSAGE_CHARS - COPY.asrFailed.length - 3;
      return room > 0 ? `${COPY.asrFailed} (${boundCode(code, room)})` : COPY.asrFailed;
  }
}
