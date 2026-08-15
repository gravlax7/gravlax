import { catboxProvider } from './catbox'
import { imgbbProvider } from './imgbb'
import type { CoverImageHostId, ImageHostProvider } from './provider'
import { redactedProvider } from './redacted'
import { thesungodProvider } from './thesungod'

export const imageHostProviders: ImageHostProvider[] = [
  thesungodProvider,
  imgbbProvider,
  catboxProvider,
  redactedProvider
]

export const imageHostProviderById: Record<CoverImageHostId, ImageHostProvider> = {
  thesungod: thesungodProvider,
  imgbb: imgbbProvider,
  catbox: catboxProvider,
  redacted: redactedProvider
}
