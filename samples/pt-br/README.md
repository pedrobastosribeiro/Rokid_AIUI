# Óculos Rokid (pt-BR)

Default glasses voice loop in **Brazilian Portuguese (`pt-BR`)**. This is the communication of the glasses, not a specialty assistant you invoke only for Portuguese.

Two layers are required:

1. **Hi Rokid system language** — menus, HUD chrome, and the built-in assistant
2. **This AIUI agent** — ASR `pt-BR`, LLM replies in pt-BR, TTS `lang=pt-BR`

An AIUI package cannot install a firmware language pack. Set the companion app language first.

## Glasses system language

On the phone, with the glasses paired:

1. Update **Hi Rokid** to G1.9.9 or later
2. Open **Language settings** and choose **Português**
3. Confirm **region** if the app offers it
4. Check for glasses firmware updates so the HUD follows the app language

After that, waking **Hi Rokid** should already talk in Portuguese. Use this agent when you need the voice loop pinned to `pt-BR` even if the host default still drifts.

## What this agent pins

| Layer | How it is set | What to expect |
|---|---|---|
| HUD / glasses copy | `lib/locale.js` + `AGENTS.md` | Strings and system instructions in pt-BR |
| ASR | `recognition.lang = 'pt-BR'` | Host ASR is asked for Brazilian Portuguese. If the host has no pt-BR model, it may fall back to its default language. |
| LLM | `LanguageModel.create({ initialPrompts })` | The model is instructed to always reply in pt-BR as the glasses' voice |
| TTS | `utterance.lang = 'pt-BR'` | The field is set, but the current runtime may still ignore `lang` / `voice` |

The page also prints `navigator.language` so you can compare the **host language** with the **requested speech language**.

## Try it

1. Open the sample in Craft: [https://js.rokid.com/craft?region=global](https://js.rokid.com/craft?region=global)
2. Import `samples/pt-br`
3. Click **Run Agent** — listening starts in `pt-BR`
4. Speak Portuguese, and check:
   - transcript language
   - model reply language
   - spoken reply (if the host TTS honors `lang`)

From the repository root, `npm test` runs locale unit tests, sample structure checks, and `aix pack`.

On the glasses:

1. In Hi Rokid, set the app language to Portuguese (G1.9.9+)
2. Pack and upload:

```bash
aix pack ./samples/pt-br -o pt-br.aix --engine '^0.14.0'
```

3. In [AIUI Studio Global](https://aiui-global.rokid.com/), create the AIUI Agent with name **Óculos Rokid** (or the wake name you want) and bind the `.aix`
4. On the glasses: **Settings → Developer → AIUI → Update Glasses Resource Package**
5. Wake the glasses and speak Portuguese. The host should route general conversation here; you can also say the agent name.

## Files

```text
samples/pt-br/
  AGENTS.md              # glasses identity + system prompts in pt-BR
  app.json
  app.js
  lib/locale.js          # locale helper, copy, LLM prompt
  pages/index/index.ink  # HUD voice loop
  README.md
```

## Next deployments

After the glasses voice loop is working in pt-BR:

1. Confirm whether host ASR actually returns Portuguese transcripts
2. If native TTS stays in another language, route speech through a cloud TTS that has a pt-BR voice (see `samples/tts`)
3. Add function tools / page schemas in Portuguese (`description` + `schema.data`)
4. Point a Custom Agent SSE endpoint at your own model if you need a specific LLM
