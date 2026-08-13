# Localizing a Voice Agent (pt-BR)

AIUI does not install a firmware language pack. To talk with the glasses in a language such as Brazilian Portuguese, configure **three separate layers**: the host app language, speech input/output, and the model prompt.

This page uses **`pt-BR`** as the first localization to deploy. A runnable implementation lives in [`samples/pt-br`](https://github.com/pedrobastosribeiro/Rokid_AIUI/tree/cursor/pt-br-locale-sample-e686/samples/pt-br).

## 1. Host language

The companion app (Hi Rokid) owns the runtime locale. From G1.9.9 it includes Portuguese UI and region settings.

The agent can read that locale, but cannot replace it:

```javascript
const language = navigator.language;
const languages = navigator.languages;
const region = navigator.region;
```

Use these values for copy fallback. Do not assume they are `pt-BR` until the user has changed the app language.

## 2. Speech recognition

Set a BCP 47 tag before `start()`. If `lang` is left empty, the host picks its default language.

```javascript
const recognition = new SpeechRecognition();
recognition.lang = 'pt-BR';
recognition.start();
```

If the host ASR has no Portuguese model, recognition may still return another language. Check the transcript on device before assuming the tag is honored.

## 3. Model replies

Force the reply language in `AGENTS.md` and in `LanguageModel` `initialPrompts`. This is the most reliable pt-BR switch today:

```javascript
const session = await LanguageModel.create({
  initialPrompts: [
    {
      role: 'system',
      content:
        'Você é um assistente de voz nos óculos Rokid. Responda sempre em português brasileiro (pt-BR). Seja curto.',
    },
  ],
});
```

`LanguageModel.availability()` does not list models. If you omit `model`, the host `defaultModel` is used.

## 4. Speech synthesis

You can set `utterance.lang = 'pt-BR'`, but the current runtime may ignore `lang`, `pitch`, `rate`, `volume`, and `voice`. Keep the field for hosts that honor it, and keep LLM output in Portuguese so a fallback voice still speaks Portuguese text.

```javascript
const utterance = new SpeechSynthesisUtterance(reply);
utterance.lang = 'pt-BR';
speechSynthesis.speak(utterance);
```

If on-device TTS stays in the wrong language, use a cloud TTS voice that supports pt-BR. See the [Minimax TTS sample](https://github.com/jsar-project/AIUI/tree/main/samples/tts).

## 5. Deploy the pt-BR sample

```bash
aix pack ./samples/pt-br -o pt-br.aix --engine '^0.14.0'
```

Then upload the package in [AIUI Studio Global](https://aiui-global.rokid.com/), update the glasses resource package, and wake the assistant with the agent name.

## Continue Reading

- **[Speech Recognition](/AIUI/guide/basic-ai-asr)**: Capture user speech.
- **[Speech Synthesis](/AIUI/guide/basic-ai-tts)**: Speak the model reply.
- **[Large Language Model](/AIUI/guide/basic-ai-llm)**: Create a session and send prompts.
