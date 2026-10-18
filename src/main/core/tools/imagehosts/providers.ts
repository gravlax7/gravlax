import { catboxProvider } from './catbox'
import { imgbbProvider } from './imgbb'
import type { CoverImageHostId, ImageHostProvider } from './provider'
import { ptscreensProvider } from './ptscreens'
import { redactedProvider } from './redacted'
import { thesungodProvider } from './thesungod'

export const imageHostProviders: ImageHostProvider[] = [
  thesungodProvider,
  imgbbProvider,
  catboxProvider,
  ptscreensProvider,
  redactedProvider
]

export const imageHostProviderById: Record<CoverImageHostId, ImageHostProvider> = {
  thesungod: thesungodProvider,
  imgbb: imgbbProvider,
  catbox: catboxProvider,
  ptscreens: ptscreensProvider,
  redacted: redactedProvider
}
