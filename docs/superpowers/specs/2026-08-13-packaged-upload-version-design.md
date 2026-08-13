# Packaged upload version

## Problem

Upload notes use a hard-coded shared version. The release command updates
`package.json` only, so packaged releases can write an old version into source
FLAC, MP3 transcode, and FLAC downconvert notes.

## Design

Use Electron's `app.getVersion()` as the runtime source. Pass that value into
`UploadSession` when the main process creates it. The session passes it through
upload report building to each of the three note generators.

Keep Electron out of the upload and description modules. They receive the
version as plain text, which keeps them easy to test and use without an Electron
runtime.

Add the app version to the upload input fingerprint. When an app update opens a
saved ready draft, the changed fingerprint rebuilds its upload report and notes
before submission. Reports already being submitted or already done keep their
stored data, as they do now.

Remove the hard-coded shared version and any unused submission-time version
field. Each upload note generator will require its caller to provide the version,
so no hidden fallback can drift from the packaged app.

## Tests

Add tests that use a fixed injected version and check the source, MP3, and
downconvert notes. Add a fingerprint test that proves a version change makes the
fingerprint change. Run the focused tests, full test suite, typecheck, and the
production build.
