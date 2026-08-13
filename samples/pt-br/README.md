# Assistente PT-BR

Sample agent that forces the voice loop into **Brazilian Portuguese (`pt-BR`)**.

Use this as the first localization deployment: ASR language, LLM system prompt, HUD copy, and TTS `lang` all target `pt-BR`, independent of whether the Hi Rokid host language is already Portuguese.

## What this sample configures

| Layer | How it is set | What to expect |
|---|---|---|
| HUD / agent copy | `lib/locale.js` + `AGENTS.md` | Strings and system instructions in pt-BR |
| ASR | `recognition.lang = 'pt-BR'` | Host ASR is asked for Brazilian Portuguese. If the host has no pt-BR model, it may fall back to its default language. |
| LLM | `LanguageModel.create({ initialPrompts })` | The model is instructed to always reply in pt-BR |
| TTS | `utterance.lang = 'pt-BR'` | The field is set, but the current runtime may still ignore `lang` / `voice` |

The page also prints `navigator.language` so you can compare the **host language** with the **requested speech language**.

## Try it

1. Open the sample in Craft: [https://js.rokid.com/craft?region=global](https://js.rokid.com/craft?region=global)
2. Import `samples/pt-br`
3. Click **Run Agent**
4. Press **Falar** / Enter, speak Portuguese, and check:
   - transcript language
   - model reply language
   - spoken reply (if the host TTS honors `lang`)

On the glasses:

1. In Hi Rokid, set the app language to Portuguese when available (G1.9.9+)
2. Pack and upload:

```bash
aix pack ./samples/pt-br -o pt-br.aix --engine '^0.14.0'
```

3. Bind the `.aix` in [AIUI Studio Global](https://aiui-global.rokid.com/)
4. On the glasses: **Settings → Developer → AIUI → Update Glasses Resource Package**
5. Wake the assistant and say the agent name **Assistente PT-BR**

## Files

```text
samples/pt-br/
  AGENTS.md              # identity + system prompts in pt-BR
  app.json
  app.js
  lib/locale.js          # locale helper, copy, LLM prompt
  pages/index/index.ink  # HUD voice loop
  README.md
```

## Next deployments

After pt-BR copy and ASR/LLM prompts are working:

1. Confirm whether host ASR actually returns Portuguese transcripts
2. If native TTS stays in another language, route speech through a cloud TTS that has a pt-BR voice (see `samples/tts`)
3. Add function tools / page schemas in Portuguese (`description` + `schema.data`)
4. Point a Custom Agent SSE endpoint at your own model if you need a specific LLM
