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
| TTS | `applyPortugueseSpeech()` + `speak(..., 'immediate')` | `lang` is pinned to `pt-BR`. If the host exposes `getVoices()`, a Portuguese voice is selected. On Craft, the spoken voice is the phone/browser voice — set Siri to Portuguese. On glasses, native `lang`/`voice` may still be ignored; keep Hi Rokid in Português. |

The page also prints `navigator.language` so you can compare the **host language** with the **requested speech language**.

## Try it

1. Open Craft Global: [https://js.rokid.com/craft?region=global](https://js.rokid.com/craft?region=global)
2. **GitHub Subdirectory Import** — paste this URL (not `main/samples/pt-br`):

```text
https://github.com/pedrobastosribeiro/Rokid_AIUI/tree/pt-br
```

   Craft looks up everything after `/tree/` as one git ref, so `/tree/main/samples/pt-br` fails with `GitHub ref not found: main/samples/pt-br`. The URL above is the long-lived `pt-br` publish branch, whose root already contains `app.json`. On a phone, select-all in the field and confirm the text ends in `/tree/pt-br` — no `main`, no `samples`.
3. Click **Run Agent** — listening starts in `pt-BR`
4. Speak Portuguese, and check:
   - transcript language
   - model reply language
   - spoken reply (if the host TTS honors `lang`)

`Enter` is deliberately not intercepted: it is what puts the host into navigation
mode, which is the only way to reach the buttons on a device with no touchscreen.
The temple button (`GlobalHook`) starts and stops a turn directly.

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
  .aixignore             # keeps docs out of the packed .aix
  AGENTS.md              # glasses identity + system prompts in pt-BR
  app.json
  app.js
  lib/locale.js          # locale helper, copy, LLM prompt
  lib/reply-format.js    # length budget, speech bound, two-channel reply
  lib/remote-model.js    # optional OpenAI-compatible model over wx.request
  lib/secrets.js         # local-only key placeholders (must stay empty in git)
  pages/index/index.ink  # HUD voice loop
  README.md
  CRAFT.md               # Craft GitHub import URL (do not use main/samples/pt-br)
```

## Optional: a remote model

The host model answers by default and needs no setup. Pointing the page at a
stronger model is opt-in, and with no key configured nothing below changes how
the sample behaves.

`lib/remote-model.js` speaks the OpenAI chat-completions shape, so it works with
any provider or gateway that does. It defaults to Groq, whose free tier costs
nothing and is fast enough that the extra round trip is not felt.

**Where the key goes.** Two places are read, in this order:

1. **Device storage** — `storeApiKey(value)` writes to `wx.setStorageSync` under
   `ptbr.remoteModel.apiKey`. Local to the device and isolated per agent
   ([storage](../../documentation/3-api/storage-api.en-US.md)), so the key never
   enters the repository or the packed `.aix`. This is the path meant to last.
2. **`lib/secrets.js`** — paste a key into `REMOTE_API_KEY` to test, then clear
   it. `npm test` fails the `secrets` check while it is non-empty.

Storage wins when both are set, so a properly provisioned device never silently
falls back to a key that shipped in the bundle.

Use a token you can revoke and do not reuse it elsewhere. A key in `secrets.js`
travels inside the `.aix` to Studio, which means it is published, and rotating
it means shipping a new build — fine for a bench test, wrong for anything else.
The path worth building instead is a QR scan: `samples/scanner` already decodes
one through `BarcodeDetector`, so the token can be shown on a phone, read once,
and stored, without ever being committed.

Set `REMOTE_BASE_URL` and `REMOTE_MODEL` to aim at something else. Aiming at a
gateway you own is the intended end state — the device then carries a token you
issue and can revoke per device, the provider key stays server-side, and
changing which model handles which question becomes a deploy instead of a
Studio republish plus a device update.

**What it changes.** The remote model is asked for two texts rather than one:
a spoken sentence and a short display fragment. They are different jobs — the
ear wants a sentence, the ~100-character panel wants a headline — and one string
serving both is what produces a reply that is too long to read and too clipped
to sound natural. The host model has no response-format option, so on that path
one string still serves both.

If the remote call fails, the host model answers instead and the reason is shown
on the error line. A 429 is ordinary on a free tier, and a wearer who asked a
question should get an answer rather than an error where the answer was.

## Next deployments

After the glasses voice loop is working in pt-BR:

1. Confirm whether host ASR actually returns Portuguese transcripts
2. If native TTS stays in another language, route speech through a cloud TTS that has a pt-BR voice (see `samples/tts`)
3. Add function tools / page schemas in Portuguese (`description` + `schema.data`)
4. Point a Custom Agent SSE endpoint at your own model if you need a specific LLM
