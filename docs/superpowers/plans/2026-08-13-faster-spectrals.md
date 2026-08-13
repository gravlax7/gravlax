# Faster Spectrals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate spectral pairs with three SoX workers, then optimize only selected pairs in the background after the user leaves the Spectrals step.

**Architecture:** `generateSpectrals` will use the existing `processFiles` worker helper and read duration from FLAC `STREAMINFO`. `compressSpectralPngs` will become a size-safe, three-worker file service. `UploadSession` will own a separate task slot that starts optimization after forward navigation and waits for current selected files before spectral hosting.

**Tech Stack:** TypeScript, Node file APIs, SoX, Sharp, Vitest, Bun.

## Global Constraints

- Use exactly three workers by default for SoX generation and PNG optimization.
- Preserve the existing SoX image size, colors, time range, and command options.
- Generate all tracks for review; optimize only selected full and zoom pairs.
- Continue from Spectrals must not wait for PNG optimization.
- Never replace an image unless the optimized file is smaller.
- Never hit the app's Submit button during manual checks.
- Do not add tracker URLs to the codebase.
- Do not add a worker-count setting.

---

### Task 1: Parallel raw spectral generation

**Files:**
- Modify: `src/main/core/tools/spectrals/generate.ts`
- Modify: `src/main/core/tools/spectrals/__tests__/generate.test.ts`

**Interfaces:**
- Consumes: `processFiles<T>(items, concurrency, worker, onProgress?, labelOf?)` and `readFLACStreamInfo(path)`.
- Produces: `generateSpectrals(workspacePath, { concurrency?, readDuration?, run?, ... })`; generation no longer accepts `compress` or `onCompress`.

- [ ] **Step 1: Replace the integrated compression test with failing generation tests**

Add tests that create five fake FLAC paths, hold fake SoX work behind a promise, and assert that exactly three calls can be active before release. Add a second test whose calls finish out of order and assert that output names still pair source index 1 with `01 Full.png` and `01 Zoom.png`. Pass `readDuration: async () => 10` so the tests cover generation without spawning SoX.

```ts
const running = new Set<string>()
let maxRunning = 0
let release!: () => void
const gate = new Promise<void>((resolve) => { release = resolve })

const generating = generateSpectrals(workspacePath, {
  readDuration: async () => 10,
  run: async (_name, args) => {
    const input = args[1]!
    running.add(input)
    maxRunning = Math.max(maxRunning, running.size)
    await gate
    running.delete(input)
    return Buffer.alloc(0)
  }
})

await vi.waitFor(() => expect(running.size).toBe(3))
release()
await generating
expect(maxRunning).toBe(3)
```

- [ ] **Step 2: Run the spectral test and verify RED**

Run: `bun run test src/main/core/tools/spectrals/__tests__/generate.test.ts`

Expected: FAIL because `readDuration` is not an option and generation runs one track at a time.

- [ ] **Step 3: Implement three-worker generation**

Import `processFiles` and `readFLACStreamInfo`. Add these options:

```ts
concurrency?: number
readDuration?: (path: string) => Promise<number>
```

Use `processFiles(files, options.concurrency ?? 3, ...)`, store each returned path pair at its source index, and flatten the indexed result after all workers finish. Map `ProcessProgress` to the existing `SpectralProgress` callback. Compute zoom start from the injected duration reader or `readFLACStreamInfo(path).durationSeconds`. Remove the serial loop, SoX `--i -D` probe, `compress`, and `onCompress`.

- [ ] **Step 4: Run the spectral test and verify GREEN**

Run: `bun run test src/main/core/tools/spectrals/__tests__/generate.test.ts`

Expected: all generation tests pass.

- [ ] **Step 5: Commit parallel generation**

```bash
git add src/main/core/tools/spectrals/generate.ts src/main/core/tools/spectrals/__tests__/generate.test.ts
git commit -m "perf: generate spectrals in parallel"
```

---

### Task 2: Size-safe selected PNG optimization

**Files:**
- Modify: `src/main/core/tools/spectrals/compress.ts`
- Modify: `src/main/core/tools/spectrals/__tests__/generate.test.ts`

**Interfaces:**
- Produces: `compressSpectralPngs(filePaths, options?) => Promise<SpectralCompressionResult>`.
- `CompressSpectralPngsOptions` contains `signal?`, `concurrency?`, and a test seam `encode?` with signature `(sourcePath, temporaryPath) => Promise<void>`.
- `SpectralCompressionResult` contains ordered `checkedPaths`, `optimizedPaths`, and `failures: Array<{ filePath: string; error: string }>`.

- [ ] **Step 1: Write failing file-behavior tests**

Use real temporary source files and injected encoders. Add separate tests for:

```ts
it('keeps an optimized file only when it is smaller', async () => {
  await writeFile(source, '12345')
  const result = await compressSpectralPngs([source], {
    encode: async (_src, temporary) => writeFile(temporary, '12')
  })
  expect(await readFile(source, 'utf8')).toBe('12')
  expect(result.optimizedPaths).toEqual([source])
})

it('keeps the source when the encoded file is not smaller', async () => {
  await writeFile(source, '12345')
  const result = await compressSpectralPngs([source], {
    encode: async (_src, temporary) => writeFile(temporary, '123456')
  })
  expect(await readFile(source, 'utf8')).toBe('12345')
  expect(result.optimizedPaths).toEqual([])
})
```

Also assert that one bad file returns a failure without rejecting or blocking another valid file, temporary files are removed, abort still rejects with `AbortError`, and a held five-file run never exceeds three active encoders.

- [ ] **Step 2: Run the spectral test and verify RED**

Run: `bun run test src/main/core/tools/spectrals/__tests__/generate.test.ts`

Expected: FAIL because the optimizer has no options, result, size check, or worker pool.

- [ ] **Step 3: Implement the optimizer contract**

Use `processFiles` with `options.concurrency ?? 3`. For each path, write to its current unique temp path, compare `stat` sizes, and rename only when the temp is smaller. Catch non-abort errors per file and store their text in `failures`; rethrow aborts. Always remove the temp file in `finally`. Keep the existing Sharp options as the default encoder.

- [ ] **Step 4: Run the spectral test and verify GREEN**

Run: `bun run test src/main/core/tools/spectrals/__tests__/generate.test.ts`

Expected: all generation and compression tests pass.

- [ ] **Step 5: Commit safe optimization**

```bash
git add src/main/core/tools/spectrals/compress.ts src/main/core/tools/spectrals/__tests__/generate.test.ts
git commit -m "perf: optimize selected spectral files safely"
```

---

### Task 3: Start selected optimization after Continue and gate hosting

**Files:**
- Modify: `src/main/services/uploadSession.ts`
- Create: `src/main/services/__tests__/uploadSessionSpectrals.test.ts`

**Interfaces:**
- Extend `UploadSessionDeps` with optional `optimizeSpectralPngs?: typeof compressSpectralPngs`; default to the real function.
- Add a `spectral-optimization` task slot, a promise for the latest run, a selection key, and a set of checked paths.
- Produce private methods `startSelectedSpectralOptimization()` and `waitForSelectedSpectralOptimization()`.

- [ ] **Step 1: Write a failing non-blocking Continue test**

Build a real temp workspace containing two FLAC names and four spectral PNG names. Put the session on the Spectrals step with IDs `[2]` and a succeeded spectral background task. Inject an optimizer that records its paths and waits on a promise.

Call `setCurrentStep(stepIndex('metadata')!)`. Assert that it returns and state moves to Metadata before the optimizer promise resolves. Then wait for the optimizer to start and assert its paths are exactly `02 Full.png` and `02 Zoom.png`.

- [ ] **Step 2: Write a failing upload-gate and retry test**

Expose `waitForSelectedSpectralOptimization` through a narrow test cast. Start the pending job, call the wait method, and assert the wait remains pending until the injected optimizer resolves. Change selected IDs, call it again, and assert only unchecked paths from the new choice run. Add a regeneration test that confirms an old job cannot add checked paths after its task is cancelled.

- [ ] **Step 3: Run the session test and verify RED**

Run: `bun run test src/main/services/__tests__/uploadSessionSpectrals.test.ts`

Expected: FAIL because the dependency, job, navigation trigger, and wait method do not exist.

- [ ] **Step 4: Implement session task control**

Import `compressSpectralPngs` and its result type. Add the dependency and task slot. On forward navigation from Spectrals, apply the new step first and then start the job without awaiting it. Resolve selected paths through `listSpectralPairs`, skip paths in the checked set, and pass the task signal to the optimizer. After each await, require `task.fresh()` before adding `checkedPaths`. Warn once when failures exist.

Clear the key and checked set when spectral generation starts, regeneration occurs, or `cancelAll` changes the workspace. In `hostImagesForSubmit`, after the existing BBCode short-circuit and before `hostSpectralsForUpload`, await optimization for the current selection. If there is no matching run, start it first.

- [ ] **Step 5: Run the session and spectral tests and verify GREEN**

Run: `bun run test src/main/services/__tests__/uploadSessionSpectrals.test.ts src/main/core/tools/spectrals/__tests__/generate.test.ts`

Expected: all focused tests pass.

- [ ] **Step 6: Commit background coordination**

```bash
git add src/main/services/uploadSession.ts src/main/services/__tests__/uploadSessionSpectrals.test.ts
git commit -m "feat: defer selected spectral optimization"
```

---

### Task 4: Full verification

**Files:**
- Modify only if verification finds a covered defect.

**Interfaces:**
- No new interfaces.

- [ ] **Step 1: Run formatting checks from TypeScript**

Run: `bun run typecheck`

Expected: both node and web TypeScript projects pass.

- [ ] **Step 2: Run the full test suite**

Run: `bun run test`

Expected: all tests pass with no warnings or unhandled rejections.

- [ ] **Step 3: Run a production build**

Run: `bun run build`

Expected: Electron main, preload, and renderer builds finish successfully.

- [ ] **Step 4: Check the final diff**

Run: `git diff --check HEAD~3..HEAD && git status --short`

Expected: no whitespace errors and no uncommitted files.
