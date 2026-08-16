// Keeping a reply short is a two-channel problem, and the two channels want
// different text.
//
// The page already clamps what is *shown* (`MAX_HUD_CHARS`). Nothing clamps
// what is *heard*, and speech is the channel that actually costs the wearer
// time: `speechSynthesis.cancel()` is not exposed on the glasses -- see
// `documentation/3-api/ai/speech-synthesis.md` -- so an over-long utterance is
// the one failure a wearer cannot escape. They wait it out. Bounding the
// display while leaving speech unbounded is the worst of the two: information
// is lost on screen and the time is spent anyway.
//
// So the bound goes in three places, weakest first:
//   1. the prompt, as a countable budget -- a request the model may ignore
//   2. the provider's `max_completion_tokens` -- a cap it cannot
//   3. this module -- the backstop that runs whatever came back
//
// Only the third is a guarantee, and it is the only one available when the
// reply comes from the host model, whose `create()` documents no generation
// options at all (`documentation/3-api/ai/language-model.md`): no temperature,
// no token limit, no response format. On that path the prompt is the only
// lever, which is exactly why the backstop has to exist.

// ~14 characters per second is a fair pt-BR speaking rate (roughly 150 wpm at
// ~5.5 characters a word), so this is about 15 seconds of audio that cannot be
// interrupted. Two natural sentences land around 120-180 characters, so an
// on-budget reply passes through untouched and only a runaway is cut.
export const MAX_SPEECH_CHARS = 220;

function normalizeText(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim();
}

// Cut speech at a sentence boundary, not at a character count. A HUD panel can
// end in "…" and the eye reads that as truncation; audio has no such signal, so
// a clause that stops mid-breath just sounds like the device broke. Ending on a
// terminator sounds like a short answer instead of a failed one.
export function clampSpeech(value, limit = MAX_SPEECH_CHARS) {
  const text = normalizeText(value);
  if (text.length <= limit) {
    return text;
  }

  const window = text.slice(0, limit);
  let lastEnd = -1;
  const terminators = /[.!?…]/g;
  let match = terminators.exec(window);
  while (match !== null) {
    lastEnd = match.index + 1;
    match = terminators.exec(window);
  }
  // A period is not proof of a sentence. "O Dr. Silva recomenda…" puts one four
  // characters in, and cutting there would speak "O Dr." and drop the answer --
  // a far worse outcome than the mid-sentence cut this branch exists to avoid.
  // So the boundary has to earn it: keep it only when it leaves most of the
  // budget used. Below that, the word-boundary fallback is the better cut.
  const MIN_USEFUL_FRACTION = 0.6;
  if (lastEnd > 0 && lastEnd >= limit * MIN_USEFUL_FRACTION) {
    return window.slice(0, lastEnd).trim();
  }

  // Nothing closed inside the budget -- one very long sentence. Fall back to a
  // word boundary so the cut is at least not mid-word, and mark it, because
  // here the reply really was interrupted.
  //
  // The ellipsis has to fit inside the budget too, or the one branch that adds a
  // character would be the one that overruns it.
  const room = window.slice(0, Math.max(0, limit - 1));
  const lastSpace = room.lastIndexOf(' ');
  const cut = (lastSpace > 0 ? room.slice(0, lastSpace) : room).trim();
  return cut ? `${cut}…` : cut;
}

// Length in an LLM reply is mostly ritual, not content: restating the question,
// a preamble before the answer, a hedge after it, and an offer to elaborate at
// the end. Naming those and banning them buys more than any adjective, and it
// is also what keeps the reply sounding human -- filler is being removed, not
// substance compressed. A truncated sentence sounds like a machine; a direct
// one sounds like someone who knows the answer.
//
// The budget is countable on purpose. "Seja curto" gives the model nothing to
// measure against, and a pixel size ("um HUD de 480x352") is worse: it is a
// fact the model cannot convert into a sentence count.
export const CONCISION_RULES = [
  'Responda em no máximo duas frases.',
  'Comece pela resposta: sem preâmbulo, sem repetir a pergunta, sem se oferecer para detalhar no fim.',
  'Se a pergunta for ampla demais para duas frases, dê o essencial e pare.',
];

// Asked of the remote model only. The host model has no response format option,
// so there is no point asking it for JSON -- it would just spend tokens on
// braces that `parseTwoChannelReply` then has to unwrap.
//
// Two fields because the channels genuinely differ: the ear wants a sentence,
// the ~100-character HUD panel wants a fragment. Making one string serve both
// is what produces the bad middle -- too long to read at a glance, too clipped
// to sound natural out loud.
export function getJsonReplyInstruction(screenLimit) {
  return [
    'Responda em JSON com exatamente dois campos, sem texto fora do JSON.',
    '"fala": a resposta falada, no máximo duas frases naturais.',
    `"tela": a mesma informação condensada para um visor, no máximo ${screenLimit} caracteres, em fragmento e não em frase.`,
  ].join(' ');
}

function stripCodeFence(text) {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : text;
}

function tryParseJson(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : null;
  } catch (_) {
    return null;
  }
}

// Never assume the two-field shape arrived intact. `json_object` mode constrains
// the body but not the wrapper -- fenced blocks are common -- and a provider or
// gateway that ignores the option returns prose. A malformed reply has to
// degrade into a usable one rather than into an error: plain text is a perfectly
// good answer, it just has to serve both channels at once.
//
// `structured` is returned so the caller can tell the two apart. It is the
// difference between "the model gave me a display line" and "I am showing the
// spoken sentence because there was nothing better", which is worth knowing
// when reading a device log.
export function parseTwoChannelReply(raw) {
  const text = normalizeText(raw);
  if (!text) {
    return { fala: '', tela: '', structured: false };
  }

  const parsed = tryParseJson(stripCodeFence(text));
  const fala = normalizeText(parsed && parsed.fala);
  if (!fala) {
    // Either it is not JSON at all, or it is JSON missing the one field that
    // cannot be empty. Speech is the channel with no fallback, so the raw text
    // becomes the spoken reply and the display shares it.
    return { fala: text, tela: text, structured: false };
  }

  return {
    fala,
    tela: normalizeText(parsed.tela) || fala,
    structured: true,
  };
}
