import { For, Show, createMemo } from 'solid-js'
import type { ReleaseAudioProfile } from '@shared/types'
import { FileChecksResult } from './FileChecksResult'

function mostCommonValue(values: number[]): number | undefined {
  const counts = new Map<number, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  const highestCount = Math.max(0, ...counts.values())
  const mostCommon = [...counts.entries()].filter(([, count]) => count === highestCount)
  return mostCommon.length === 1 ? mostCommon[0]?.[0] : undefined
}

export function AudioSettingsResult(props: { audio: ReleaseAudioProfile }) {
  const mixed = () => props.audio.mixedBitDepth || props.audio.mixedSampleRate
  const commonBitDepth = createMemo(() =>
    mostCommonValue(props.audio.tracks.map((track) => track.bitDepth))
  )
  const commonSampleRate = createMemo(() =>
    mostCommonValue(props.audio.tracks.map((track) => track.sampleRate))
  )
  const bitDepthDiffers = (bitDepth: number) =>
    props.audio.mixedBitDepth &&
    (commonBitDepth() === undefined || bitDepth !== commonBitDepth())
  const sampleRateDiffers = (sampleRate: number) =>
    props.audio.mixedSampleRate &&
    (commonSampleRate() === undefined || sampleRate !== commonSampleRate())

  return (
    <Show when={mixed()}>
      <FileChecksResult tone="warning" icon="alert-triangle">
        <div class="file-checks-headline">Mixed FLAC audio properties</div>
        <div class="file-checks-sub">
          Check your source records and make sure the files were supplied this way.
        </div>
        <div class="file-checks-audio-hint">Highlighted values show where properties differ.</div>
        <div class="file-checks-audio-list">
          <div class="file-checks-audio-header" aria-hidden="true">
            <span>Track</span>
            <span>Bit depth</span>
            <span>Sample rate</span>
          </div>
          <For each={props.audio.tracks}>
            {(track) => {
              const differs = () =>
                bitDepthDiffers(track.bitDepth) || sampleRateDiffers(track.sampleRate)
              return (
                <div
                  class="file-checks-audio-row"
                  classList={{ 'file-checks-audio-row-different': differs() }}
                >
                  <span class="mono file-checks-audio-path">{track.relativePath}</span>
                  <span
                    class="mono file-checks-audio-value"
                    classList={{
                      'file-checks-audio-value-different': bitDepthDiffers(track.bitDepth)
                    }}
                  >
                    {track.bitDepth} bit
                  </span>
                  <span
                    class="mono file-checks-audio-value"
                    classList={{
                      'file-checks-audio-value-different': sampleRateDiffers(track.sampleRate)
                    }}
                  >
                    {(track.sampleRate / 1000).toFixed(1)} kHz
                  </span>
                </div>
              )
            }}
          </For>
        </div>
      </FileChecksResult>
    </Show>
  )
}
