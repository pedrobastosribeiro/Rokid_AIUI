# Working in this repository

Developer tools, skills, samples, and documentation for AIUI — a JavaScript agent runtime for AI glasses with a display. There is no application to run here: the samples target a device runtime, and the docs are consumed by an external site.

Everything below is repository-specific and cost someone time to discover. General practice is assumed, not repeated.

## Checks

`npm test` is the single entry point, and CI runs the same command:

```bash
npm test                              # every check
node scripts/ci/validate.mjs links    # one check
```

Checks are `json`, `syntax`, `samples`, `whitespace`, `tests`, `pack`, `links`. `pack` fetches `aix-cli` and packs all samples, so it is the slow one.

The validator is deliberately dependency-free — the repo ships no tooling lockfile. Keep it that way; a new check should use Node built-ins and `git ls-files`.

Publishing `create-aiui-agent` to npm gates on these checks, so a red run blocks the release. The publish is triggered by bumping `version` in `packages/create-aiui-agent/package.json` on `main`; it skips itself when that version is already on the registry.

## `AGENTS.md` is a format, not a readme

In this repo `AGENTS.md` is a specification — an agent manifest with a required shape (`# Agent: <name>`, `## System Prompts`, `## Capabilities`), defined in [the Open Agent Format docs](documentation/1-framework/open-agent-format/agents.md). Every sample has one, and `create-aiui-agent` scaffolds one into each new project.

Do not put repository prose in a file named `AGENTS.md`. Repository guidance goes here.

## Writing `.ink` samples

A page is either one `.ink` single-file component or the multi-file form (`index.js` + `index.wxml` + `index.wxss` + `index.json`). The logic file alone renders nothing.

**Only use confirmed WXSS properties.** [`skills/aiui-dev/wxss.md`](skills/aiui-dev/wxss.md) lists what the renderer actually supports. `overflow` and `max-height` are *not* on it — only `position` appears under "Positioning And Overflow" — so a layout that depends on them may not hold. Bound variable-length text in JavaScript and treat CSS as the backstop.

**The canvas is 480 × 352 and does not scroll.** Fixed chrome eats roughly 193px of the 328px inner height, so two stacked panels get about two lines of 14px text each. Anything that can grow — a model reply, a transcript, a host error string — needs an explicit bound, or it pushes the action row off the display where no one can reach it.

**Layout defaults to a row.** Ink lays out on Taffy, so every stacking container needs `flex-direction: column` explicitly. Give non-shrinking chrome `flex-shrink: 0` and let content panels absorb the pressure.

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
