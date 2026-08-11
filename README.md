# Gravlax

Gravlax prepares music releases for Gazelle-based trackers. It guides each
release through file checks, spectrals, metadata, tags, transcodes, upload, and
seeding.

## Quick start

1. Download and open Gravlax from the [latest release](https://github.com/gravlax7/gravlax/releases).
2. Install the required command-line tools listed below. Put them on your `PATH`,
   or set their paths in **Settings → Tools**.
3. Open **Settings** and set up your folders, a tracker, and an image host. Then
   open **Healthcheck** and fix any items marked missing or failing.
4. Choose a release folder from the start screen and work through the seven
   steps.

## Supported services

| Type | Supported services |
| --- | --- |
| Image hosts | Ra (thesungod), ImgBB, and the Redacted image host |
| Metadata providers | MusicBrainz and Deezer |
| Torrent clients | qBittorrent through its Web UI |

Only ImgBB supports spectral uploads. The Redacted image host requires an
enabled Redacted tracker with an API key, and it can be uses only for
Redacted cover images.

Support for more image hosts, metadata providers, and torrent clients can be discussed.

## Import settings from smoked-salmon

If you use smoked-salmon, open **Settings → Import**, choose its `config.toml`,
review the suggested changes, select the ones you want, and save the settings.
The usual config locations are:

- macOS: `~/Library/Application Support/smoked-salmon/config.toml`
- Linux: `~/.config/smoked-salmon/config.toml`

It can also read `rclone.conf` when your smoked-salmon seedbox uses rclone. The
importer shows every change before it applies it, so you can keep or skip each
setting.

## Required external tools

Install these tools and make sure Gravlax can find them:

| Tool | Used for |
| --- | --- |
| SoX | Spectrals and FLAC downconversion |
| FLAC tools (`flac` and `metaflac`, usually installed together) | FLAC checks, decoding, and tags |
| mp3val | MP3 checks |
| LAME | MP3 encoding |

Leave a tool path blank in **Settings → Tools** to let Gravlax search your
`PATH` and common install locations.

## Important settings

- **Directories:** Set **Source** to the folder that holds releases before you
  upload them. Set **Torrents** if you want to keep created torrent files, and
  **Seeding** when you seed with a local client.
- **Trackers:**   Tracker URLs are not included in the application's code, you need to find them yourself and enter them in settings.
  Enable each tracker you use and enter an API key and session cookie. Both are required for Gravlax to work properly.
- **Image Hosts:** Enable an image host and add its API key where needed. Pick
  the host for spectrals and each tracker.
  Redacted IH and Ra cannot be used for spectrals upload.
- **Torrent Client:** Set this up if you seed through qBittorrent's Web UI.
- **Seedbox:** Turn this on only when you want Gravlax to send release folders
  over SFTP before it adds the torrent.
- **Metadata Providers:** MusicBrainz is on by default. You can also enable
  Deezer.

Use **Healthcheck** after any change. Gravlax is ready when it reports that the
required tools, at least one image host, and every enabled tracker are available.

## Development

This repo targets Node.js 24 for local tools and CI. Bun runs the project
scripts, so install Bun as well.

```bash
bun install
bun run dev
```

### Test

```bash
bun test
bun run typecheck
```

### Package

```bash
bun run dist       # all configured targets
bun run dist:mac
bun run dist:linux
bun run dist:win
```
