## Thinking, writing and answering style

Never use a metaphor, simile, or other figure of speech which you are used to seeing in print.
Never use a long word where a short one will do.
If it is possible to cut a word out, always cut it out.
Never use the passive where you can use the active.
Never use a foreign phrase, a scientific word, or a jargon word if you can think of an everyday English equivalent.
Break any of these rules sooner than say anything outright barbarous.

## What this is

Gravlax is an Electron desktop app that walks a music release through an 7-step upload pipeline to Gazelle-based music trackers: files check → spectrals → metadata → tags → transcode → upload → seed. It is a TypeScript/Solid.js project.
Inspired by `smoked-salmon` (the Python original lives at `../smoked-salmon` and is a useful reference for tracker/tooling behaviour).

## Commands

```bash
bun run dev          # electron-vite dev (main + preload + renderer with HMR)
bun run typecheck    # tsc --noEmit for both node and web projects — the only "lint"
bun run test         # vitest run
bun run test:watch
bun run dist:mac     # build + electron-builder (also :linux, :win, or bare `dist`)
```

Run a single test file or case:

```bash
npx vitest run src/main/core/uploadflow/__tests__/upload.test.ts -t 'maps artist roles'
```

Runtime depends on external binaries on `PATH`: `sox`, `flac`, `mp3val`, `lame`, and optionally `flaccheck`. They are probed in `src/main/services/healthcheck.ts` and surfaced in the Healthcheck screen.

## Rules
If you ever take control of the app to test something, be sure to NEVER hit the submit button.

Don't write tracker URLs in the codebase
