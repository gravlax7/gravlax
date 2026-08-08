export { inspectTranscode, gatherTrackAudioInfo, findLossyFiles, deriveEncoding } from './audioInfo'
export {
  LOSSY_EXTENSIONS,
  IMAGE_EXTENSIONS,
  SKIP_EXTENSIONS
} from './audioInfo'
export { getDownconversionOptions, resolveSampleRateFamily } from './options'
export { buildMp3OutputPath, buildDownconvertOutputPath, outputFolderName } from './naming'
export { prepareTags, readPreparedFlacTags, readFlacPictures, writeMp3Tags } from './tags'
export { transcodeFolder, generateTranscodeDescription, LAME_COMMAND_MAP } from './mp3'
export type { TranscodeFolderResult } from './mp3'
export { convertFolder, generateConversionDescription, SOX_DEPTH_ARGS } from './flacConvert'
export type { ConvertFolderResult } from './flacConvert'
export { copyExtraFiles } from './extras'
export { processFiles } from './processFiles'
export type { ProcessProgress } from './processFiles'
export type { TrackAudioInfo } from './audioInfo'
