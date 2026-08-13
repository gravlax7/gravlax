# Remove Spectral Compression

## Goal

Keep spectral handling fast and simple by removing PNG compression. Preserve the three-worker SoX generation added on this branch.

## Changes

- Delete the Sharp-based spectral compressor and its tests.
- Delete all delayed optimization work from `UploadSession`, including its task slot, selection tracking, upload wait, warnings, and injected test dependency.
- Remove the Compress control and `spectral.compress` from the config schema, defaults, settings field handling, IPC checks, fixtures, and tests.
- Stop importing `compress_spectrals` from smoked-salmon config.
- Remove Sharp from app dependencies and refresh `bun.lock`.
- Accept old saved configs that still contain `spectral.compress`; the normal config merge already ignores unknown fields.

## Flow

SoX generates every full and zoom spectral with three workers. The Spectrals step displays those files. Continue only advances the workflow. Submit hosts the chosen files as SoX wrote them.

## Tests

- Parallel generation still caps active SoX tasks at three.
- Output numbering stays fixed when tasks finish out of order.
- Config and IPC fixtures no longer require a compression field.
- Salmon import ignores `compress_spectrals`.
- Type checks, all tests, and the production build pass without Sharp.

## Out of scope

- Adding a different PNG optimizer.
- Changing SoX output settings.
- Caching generated spectrals.
