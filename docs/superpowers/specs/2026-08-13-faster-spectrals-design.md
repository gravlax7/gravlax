# Faster Spectrals Design

## Goal

Cut the time from source choice to a ready Spectrals step, while keeping the app responsive and preserving the current images.

The main gain comes from making SoX work on more than one track at a time. PNG work moves out of the path to the Spectrals step and runs only for images chosen for upload.

## Current flow

`generateSpectrals` runs one SoX task per track in a serial loop. It then runs Sharp on every full and zoom PNG in a second serial loop. The Spectrals task does not finish until both loops finish.

SoX already writes palette PNGs. In a local eight-track test, the Sharp pass took about as long as SoX and made the set larger. The new flow must therefore keep an optimized file only when it is smaller.

## New flow

### 1. Parallel generation

Generate tracks with the existing `processFiles` worker helper and a worker limit of three.

Each worker:

1. Reads the track length from FLAC `STREAMINFO`.
2. Runs the existing SoX command once to create the full and zoom PNGs.
3. Reports that track as done.

File names still come from the source array index, so task finish order cannot change spectral numbering. The task finishes as soon as all raw PNGs exist. PNG optimization is no longer part of generation.

Three workers match the limit used by transcodes and the old app. This gives a large speed gain without taking every CPU while file checks, tag reads, and metadata work run.

### 2. Optimize after Continue

When the user leaves Spectrals in the forward direction, start a background optimization job for the selected spectral IDs. Navigation continues at once.

The job takes a copy of the chosen IDs and maps each ID to its full and zoom PNG. It uses up to three workers. Each worker:

1. Writes an optimized PNG to a unique temporary path.
2. Checks the source and result sizes.
3. Replaces the source with one atomic rename only when the result is smaller.
4. Removes the temporary file in all other cases.

If compression is off in Settings or no spectral is selected, no job starts.

### 3. Selection changes and regeneration

Going back to Spectrals, changing the choices, and moving forward starts a new job for the current choices. Files that have already passed optimization do not need to run again in the same spectral generation.

Regenerating spectrals cancels the optimization job, replaces the Spectrals folder, and clears its record of optimized files. A job from an old generation must not rename a file from the new generation.

Changing the workspace also cancels the job through the current task scope.

### 4. Upload gate

Submit waits for optimization of the current selected IDs before it hosts any spectral images. In the usual flow this wait should be zero because optimization runs while the user completes Metadata, Tags, and Transcode.

If the choices changed without a matching background run, Submit starts and waits for the missing work before hosting.

Optimization is optional work. A Sharp error keeps the raw SoX image, records a warning, and does not stop upload. Cancellation caused by a new workspace, regeneration, or task shutdown stays silent.

## State and code boundaries

- `generateSpectrals` owns raw image generation and track progress.
- `compressSpectralPngs` accepts only the paths chosen for upload, uses the worker limit, and replaces a file only when smaller.
- `UploadSession` owns the background job, its generation guard, the set of paths already checked, and the Submit wait.
- `hostSpectralsForUpload` continues to host the selected files. It does not start optimization itself.
- The existing `spectrals` background task reports generation only. Delayed optimization must not turn a completed Spectrals step back into a running step.

## Tests

Add tests that prove:

- no more than three SoX tasks run at once;
- track numbering stays stable when tasks finish out of order;
- generation completion does not wait for PNG optimization;
- only selected full and zoom files are sent to optimization;
- Continue does not wait for optimization;
- Submit waits for unfinished optimization;
- a smaller result replaces its source;
- an equal, larger, or failed result leaves its source unchanged and removes its temporary file;
- a second selection run skips paths already checked;
- regeneration or workspace change prevents an old job from replacing new files;
- compression disabled and an empty selection both do no work.

## Success checks

On an eight-track release, parallel generation should take far less wall time than serial generation. With three workers, the local test cut generation from 2.40 seconds to 0.98 seconds.

The Spectrals step must show all raw images as soon as generation ends. Continuing must feel instant. Upload must host only the chosen full and zoom pairs, and PNG optimization must never increase their size.

## Out of scope

- Changing spectral size, colors, time range, or SoX settings.
- Generating only the default selected track. Users still need every spectral for review.
- Reusing spectral files across app restarts or source copies.
- Adding a new worker-count setting.
