# AIUI Developer Tools & Skills

This repository provides developer tools, a scaffolding CLI, AI agent skills, sample apps, and documentation for building applications on **AIUI**. See `README.md` for the full overview.

## Cursor Cloud specific instructions

This is primarily a tooling + samples + documentation repository. What is actually runnable inside a Cloud VM is limited, so keep expectations scoped:

- **`packages/create-aiui-agent` (the runnable application)** — a zero-dependency Node.js CLI that scaffolds a new AIUI agent project from `packages/create-aiui-agent/template/`. Run it directly with `node packages/create-aiui-agent/index.js <project-name>` (creates `<project-name>/` in the current working directory and substitutes `{{PROJECT_NAME}}` placeholders). It refuses to run with no argument (exit 1) or if the target dir already exists. This is the best "hello world" to verify the environment.
- **No dependencies to install for the CLI.** The root `package.json` declares no dependencies and the sample/template `package.json` files have empty `dependencies`. `npm install` is effectively a no-op. Note the committed root `package-lock.json` is orphaned (it references `vitepress`/`vue`, but the root `package.json` has no such deps and there is no `.vitepress/` config), so do not expect a docs site to build/run — `npm ci` / `npm install` install nothing.
- **No lint or test setup exists.** There is no ESLint/Prettier config and no test framework. Root `npm test` intentionally errors (`"Error: no test specified"`); do not treat that as a real test suite.
- **Samples are not runnable in the VM.** Everything under `samples/` (and the generated template's `npm start`) targets the external AIUI/`jsui`/`aix` runtime for AI glasses, which is not available here. Their `start` scripts (e.g. `jsui start`) require that external toolchain. Treat samples as source/reference to read and edit, not to execute.
- **Design preview** — `design/monochrome/preview-green.html` is a self-contained static HTML file (no build step); open it directly in a browser if you need to view the design tokens.
