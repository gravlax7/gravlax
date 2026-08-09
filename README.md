# Gravlax

## Develop

This repo targets Node.js 24 for local tools and CI. Bun runs the project
scripts, so install Bun as well.

```bash
bun install
bun run dev
```

## Test

```bash
bun test
bun run typecheck
```

## Package

```bash
bun run dist       # all configured targets
bun run dist:mac
bun run dist:linux
bun run dist:win
```
