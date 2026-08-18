# Working in this repository

Developer tools, skills, samples, and documentation for AIUI — a JavaScript agent runtime for AI glasses with a display. There is no application to run here: the samples target a device runtime, and the docs are consumed by an external site.

Everything below is repository-specific and cost someone time to discover. General practice is assumed, not repeated.

## Checks

`npm test` runs `node scripts/ci/validate.mjs` — eight checks: `json`, `syntax`, `samples`, `secrets`, `whitespace`, `tests`, `pack`, `links`. Pass names for a subset:

```bash
npm test                              # every validate.mjs check
node scripts/ci/validate.mjs links    # one check
```

`pack` fetches `aix-cli` and packs all samples, so it is the slow one.

That is not the whole CI gate. `.github/workflows/pr-checks.yml` has three jobs: `validate` (the static checks), `pack` (the pack check), and `scaffold`, which `npm pack`s `packages/create-aiui-agent`, installs the tarball, drives the installed binary, and asserts the generated files. `validate.mjs` does none of that, so a regression in `files`, `.npmignore`, or bin packaging passes `npm test` and still fails CI and the publish workflow.

The validator is deliberately dependency-free — the repo ships no tooling lockfile. Keep it that way; a new check should use Node built-ins and `git ls-files`.

`secrets` exists because a sample that calls a paid or rate-limited API needs a real key on the device to be testable at all, and the shortest path to that is pasting one into the source — from where it travels into the packed `.aix`, up to Studio, and into this history, which deleting the line later does not undo. Two samples take opposite approaches and both are fine: `samples/tts` injects `getAuthorization` and refuses to play without it, while `samples/pt-br` keeps a `lib/secrets.js` of empty placeholders meant to be filled in locally. The check is what makes "emptied before commit" enforceable rather than remembered. **Note it only sees tracked files** — `git ls-files` — so a key in a file you have not `git add`ed yet passes, and then fails the moment you stage it.

Publishing `create-aiui-agent` to npm gates on the full `pr-checks` workflow (validate + pack + scaffold), so a red run blocks the release. The publish is triggered by bumping `version` in `packages/create-aiui-agent/package.json` on `main`; it skips itself when that version is already on the registry.

## `AGENTS.md` is a format, not a readme — except at the repo root

Two different jobs share the same filename. Do not collapse them.

- **`samples/*/AGENTS.md` and `packages/create-aiui-agent/template/AGENTS.md`** are agent manifests for samples and the scaffold, not repository guidance. Write the **Identity form** — `# Agent Manifest`, then `## Identity` with a `- **Name**:` line, then `## Capabilities`:

  ```markdown
  # Agent Manifest

  ## Identity
  - **Name**: Mav
  - **Version**: 0.2.0

  ## Capabilities
  - **Permissions**:
    - microphone
    - network
  ```

  **Not the shape the spec describes.** [The Open Agent Format spec](documentation/1-framework/open-agent-format/agents.md) documents `# Agent: <name>` / `## System Prompts` / `## Capabilities` / `## Configuration` / `## Dependencies`, and AIUI Studio rejects it: it validates the packed `AGENTS.md` for the Identity form, and a `# Agent: …` title with no `Name` field is not enough — see [`samples/pt-br/CRAFT.md`](samples/pt-br/CRAFT.md). `samples/pt-br` was the last file following the spec and was moved off it in `47dea96` for exactly that reason, so today **no manifest in this repo follows the spec, and none should**. Treat the spec page as describing a format the platform does not yet accept; a manifest "corrected" toward it stops uploading.

  Three carry the complete form: `bluetooth`, `capabilities`, `pt-br` — copy one of those. `scanner` and `tts` have `## Identity` and a `Name` but sit under a title heading instead of `# Agent Manifest`; only `pt-br` has actually been through a Studio upload, so treat those two as untested rather than as a second valid shape. The remaining four — the scaffold template, `cut-card`, `games`, `meal-card` — have no `Name` field and would not validate as they stand. Fix one when you are already working in it, not as a sweep, and never put repository prose in any of them.
- **The root `AGENTS.md`** is Cursor Cloud / cross-tool **agent operating guidance**: what a Cloud VM can and cannot run (the scaffolding CLI, `npm test` vs `pack`'s network need, the fact that there is nothing to install at the root). Cursor Cloud and other agents load that filename automatically; the filename *is* the mechanism. Do not rename it to `DEVELOPMENT.md`, do not treat it as a misplaced manifest, and do not fold its content into this file.

Repository authoring conventions (this document) go here. Cloud VM operating guidance goes in the root `AGENTS.md`.

## Writing `.ink` samples

A page is either one `.ink` single-file component or the multi-file form (`index.js` + `index.wxml` + `index.wxss` + `index.json`). The logic file alone renders nothing.

**Only use confirmed WXSS properties.** [`skills/aiui-dev/wxss.md`](skills/aiui-dev/wxss.md) lists what the renderer actually supports. `overflow` and `max-height` are *not* on it — only `position` appears under "Positioning And Overflow" — so a layout that depends on them may not hold. Bound variable-length text in JavaScript and treat CSS as the backstop.

**The canvas is 480 × 352 and does not scroll.** Fixed chrome eats roughly 193px of the 328px inner height, so two stacked panels get about two lines of 14px text each. Anything that can grow — a model reply, a transcript, a host error string — needs an explicit bound, or it pushes the action row off the display where no one can reach it.

**Bounding the display does not bound the speech.** These are two channels with two costs, and clamping only the visible one is the worst split — information is lost on screen and the wearer's time is spent anyway. `speechSynthesis.cancel()` is not exposed, so an over-long utterance is the one failure a wearer cannot escape; they wait it out. `samples/pt-br/lib/reply-format.js` bounds speech separately and cuts on a sentence terminator rather than a character count, because audio has no equivalent of the HUD's trailing `…` — a clause that stops mid-breath just sounds like the device broke. The same file also holds the length rules for the prompt, and they are worth reading before writing new ones: a countable budget ("no máximo duas frases") plus explicit bans on preamble, restating the question, and offering to elaborate. `Seja curto` gives the model nothing to measure, and a pixel size gives it a fact it cannot convert into a sentence count.

**Say the direction, both ways.** Ink lays out on Taffy, so every stacking container needs `flex-direction: column` explicitly — and the converse bit us too: `samples/pt-br`'s action row carried `display: flex` with no direction, trusting the row default, and rendered as a column in Craft. Three full-width buttons where one row was budgeted is ~60px the chrome arithmetic never accounted for, taken straight out of the content panels, which then overflow. Nothing clips that — `overflow` is not on the confirmed WXSS list — so the text draws on top of itself, and the symptom reads as a text bug rather than a layout one. If a container must be a row, write `flex-direction: row`. Give non-shrinking chrome `flex-shrink: 0` and let content panels absorb the pressure.

**Do not intercept `Enter`.** Its host default is to enter navigation mode or activate the focused target, which is the only way to reach a `bindtap` button on a device with no touchscreen. Calling `preventDefault()` on it makes on-screen buttons unreachable. The temple button (`GlobalHook`) has no host default and is the right key for a page shortcut.

**Read the capability scope before relying on an API.** The `documentation/3-api/` pages list what is actually wired up. Notably: `speechSynthesis.speak()` defaults to `'enqueue'` and `cancel()` is not exposed, so pass `'immediate'` unless you want replies to stack; utterance lifecycle events do not exist, so you cannot know when speech ends; and a `SpeechRecognitionErrorEvent` carries its diagnostic in `.error`, not `.message`.

Samples are ESM — they inherit `"type": "module"` from the root `package.json`. A sample with its own `package.json` must declare it.

## Documentation

Pages come in bilingual pairs: `foo.md` (zh-CN) and `foo.en-US.md`. Change both, and keep code examples locale-neutral — a reader copying the entry-point snippet from the Chinese page should not get another language's settings.

Both `documentation/toc.json` and `documentation/toc.en-US.json` need updating when pages move. **Their id-to-file resolution is irregular** — `page/focus` resolves to `focus.md`, `page/definition` to `page-definition.md`, `packages` to `package.md` — so it is not mechanically checkable and no check validates it. Verify TOC edits by hand.

Relative links may omit the extension; the site resolves those. Never link to a review branch — `links` fails on it, because such a URL dies with the branch.

## Packaging

```bash
npx --yes @yodaos-pkg/aix-cli@0.8.2 pack ./samples/<name> -o out.aix --engine '^0.14.0'
```

`--engine` is real despite being absent from older revisions of the CLI reference; `aix --help` is the authority on flags, not the docs page.

Add a `.aixignore` to any sample carrying a README so documentation stays out of the device bundle.

## The `pt-br` branch is generated, not written

Craft resolves everything after `/tree/` as one git ref, so `/tree/main/samples/pt-br` looks up a branch named `main/samples/pt-br` and fails. `sync-craft-pt-br.yml` therefore subtree-splits `samples/pt-br` onto a branch named `pt-br`, whose root is the sample, and that is the URL the READMEs and quickstarts document. Never commit to it — the next push to `main` force-pushes over whatever is there.

**It runs on every push to `main`, with no `paths:` filter, and that is deliberate.** Republishing an identical tree is a no-op, so running always is what makes the branch repair itself: a run that fails, gets cancelled, or is force-pushed over by hand is corrected by the next commit. Add a filter back and repair stops being automatic — it then takes another edit to the sample, or someone noticing and dispatching the workflow by hand, which is how a stale import URL survives unnoticed.

Verification belongs in that workflow, not in `pr-checks`. It is the job holding `contents: write`, so whoever sees it go red can re-run it — a drift check in the PR checks would redden unrelated pull requests, and every fork PR, over a state their author cannot fix, and would block the `create-aiui-agent` release through `publish-create-aiui-agent.yml`'s `needs: checks`.
