# Glasses language (pt-BR)

AIUI does not install a firmware language pack. To make the **glasses** communicate in Brazilian Portuguese — not only a specialty assistant — configure **four layers**: the Hi Rokid system language, speech input, the model prompt, and speech output.

A runnable glasses voice loop lives in [`samples/pt-br`](../../../../samples/pt-br).

## 1. Glasses system language (required)

The companion app (Hi Rokid) owns menus, HUD chrome, region, and the built-in assistant. From G1.9.9 it includes Portuguese UI.

On the paired phone:

1. Update Hi Rokid to G1.9.9 or later.
2. Open **Language settings** and choose **Português**.
3. Set **region** when the app offers it.
4. Check for glasses firmware updates so the HUD follows the app language.

An AIUI agent can read that locale, but cannot replace it:

```javascript
const language = navigator.language;
const languages = navigator.languages;
const region = navigator.region;
```

Use these values for copy fallback. Until the user changes the app language, `navigator.language` may still be English or Chinese even if your agent replies in pt-BR.

## 2. Speech recognition

Set a BCP 47 tag before `start()`. If `lang` is left empty, the host picks its default language.

```javascript
const recognition = new SpeechRecognition();
recognition.lang = 'pt-BR';
recognition.start();
```

If the host ASR has no Portuguese model, recognition may still return another language. Check the transcript on device before assuming the tag is honored.

## 3. Model replies

Force the reply language in `AGENTS.md` and in `LanguageModel` `initialPrompts`. This is the most reliable pt-BR switch inside an AIUI agent. Treat the model as the glasses' voice, not as a separate app:

```javascript
const session = await LanguageModel.create({
  initialPrompts: [
    {
      role: 'system',
      content:
        'Você é a voz dos óculos Rokid. Fale sempre em português brasileiro (pt-BR). Seja curto.',
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

## 5. Deploy the glasses voice loop

```bash
aix pack ./samples/pt-br -o pt-br.aix --engine '^0.14.0'
```

Then upload the package in [AIUI Studio Global](https://aiui-global.rokid.com/), update the glasses resource package, and speak Portuguese. Name the Studio application as the glasses voice (for example **Óculos Rokid**), not as a specialty assistant.

## Continue Reading

- **[Speech Recognition](/AIUI/guide/basic-ai-asr)**: Capture user speech.
- **[Speech Synthesis](/AIUI/guide/basic-ai-tts)**: Speak the model reply.
- **[Large Language Model](/AIUI/guide/basic-ai-llm)**: Create a session and send prompts.
