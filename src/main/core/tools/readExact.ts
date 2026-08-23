import type { FileHandle } from 'node:fs/promises'

export async function readExact(
  handle: FileHandle,
  buffer: Buffer,
  position: number | null = null
): Promise<void> {
  let offset = 0
  while (offset < buffer.length) {
    const readPosition = position === null ? null : position + offset
    const { bytesRead } = await handle.read(
      buffer,
      offset,
      buffer.length - offset,
      readPosition
    )
    if (bytesRead === 0) throw new Error('unexpected EOF')
    offset += bytesRead
  }
}
