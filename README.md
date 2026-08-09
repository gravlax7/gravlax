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

## Releases

GitHub Actions tests every pull request and push to `main`. Pushing a tag that
matches the version in `package.json` creates a GitHub Release with macOS,
Windows, and Linux installers plus `SHA256SUMS.txt`.

To make a release, bump and merge the version, then tag and push it:

```bash
git tag v0.2.1
git push origin v0.2.1
```

Check a downloaded installer against `SHA256SUMS.txt` with `shasum -a 256 -c`
on macOS or `sha256sum -c` on Linux. The first releases are unsigned: macOS
and Windows will show a security warning before opening the installer.
