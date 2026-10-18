import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { writeSyntheticFlac } from '../../tools/__tests__/helpers/audioFixture'
import { runCommand } from '../../tools/runCommand'
import { inspectTranscode } from '../../tools/transcode'
import { checkMQAWorkspace } from '../mqa'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function release(tags: string[][]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'gravlax-mqa-'))
  roots.push(root)
  for (const [index, args] of tags.entries()) {
    const path = join(root, `0${index + 1}.flac`)
    await writeSyntheticFlac(path, { bitsPerSample: 24, sampleRate: 48_000 })
    if (args.length > 0) await runCommand('metaflac', [...args, path])
  }
  return root
}

describe('MQA', () => {
  it('finds MQA by tag when the syncword check misses it', async () => {
    const root = await release([
      [],
      ['--set-tag=MQAENCODER=MQAEncode v1.1, 2.4.0+0 (a6e3fa0)'],
      ['--set-tag=ENCODER=mqaencode 1.2']
    ])
    const summary = await checkMQAWorkspace(root, { check: async () => false })
    expect(summary.mqaPaths).toEqual(['02.flac', '03.flac'])
    expect(summary.errors).toEqual([])
  })

  it('offers no transcodes for an MQA release', async () => {
    const root = await release([[]])
    expect((await inspectTranscode(root)).options.length).toBeGreaterThan(0)

    const inspection = await inspectTranscode(root, ['01.flac'])
    expect(inspection.options).toEqual([])
    expect(inspection.blockers).toEqual([{ kind: 'mqa', message: 'MQA files cannot be transcoded.' }])
  })
})
