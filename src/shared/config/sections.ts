import type { SectionMetadata } from '@shared/types/config'

export function sections(): SectionMetadata[] {
  return [
    {
      id: 'appearance',
      title: 'Appearance',
      description: 'Theme and visual preferences.',
      fields: [
        {
          name: 'theme',
          label: 'Theme',
          description: 'Follow the system or choose a color theme.',
          type: 'enum',
          options: ['system', 'dark', 'midnight', 'fjord', 'ember', 'phosphor', 'light', 'inkwell']
        }
      ]
    },
    {
      id: 'directories',
      title: 'Directories',
      description:
        'Select the directories Gravlax will use.',
      fields: [
        { name: 'source', label: 'Source', description: 'Folder where you place releases before uploading. Acts as a source for new uploads so you don\'t have to import folders manually.', type: 'path' },
        { name: 'torrents', label: 'Torrents', description: 'Optional folder to store torrent files after uploading.', type: 'path' },
        {
          name: 'seeding',
          label: 'Seeding',
          description:
            'Where releases are placed for a local torrent client when the seedbox is off. Hardlinked when it shares a volume with the workspace. Also used as the torrent save path unless Torrent Client → Save path overrides it.',
          type: 'path'
        }
      ]
    },
    {
      id: 'tools',
      title: 'Tools',
      description:
        'Optional executable paths. Leave a field empty to search the system and common install locations.',
      fields: [
        { name: 'sox', label: 'SoX', description: 'Version 14.4.2 or newer. Used for spectrals and FLAC downconversion.', type: 'file' },
        { name: 'flac', label: 'FLAC', description: 'Version 1.5.0 or newer. Used to verify and decode FLAC files.', type: 'file' },
        { name: 'metaflac', label: 'metaflac', description: 'Version 1.5.0 or newer. Used to read and write FLAC metadata.', type: 'file' },
        { name: 'lame', label: 'LAME', description: 'Version 3.100 or newer. Used to encode MP3 files.', type: 'file' }
      ]
    },
    {
      id: 'imageHosts',
      title: 'Image Hosts',
      description: 'Enable any combination of the supported image hosts.',
      fields: [
        { name: 'thesungod.enabled', label: 'thesungod enabled', type: 'bool' },
        { name: 'thesungod.apiKey', label: 'thesungod API key', type: 'string', sensitive: true },
        { name: 'imgbb.enabled', label: 'imgbb enabled', type: 'bool' },
        { name: 'imgbb.apiKey', label: 'imgbb API key', type: 'string', sensitive: true },
        { name: 'catbox.enabled', label: 'Catbox enabled', type: 'bool' },
        {
          name: 'redacted.enabled',
          label: 'Redacted Image Host',
          description: 'Uses your Redacted tracker credentials. Requires Redacted to be enabled and configured.',
          type: 'bool'
        }
      ]
    },
    {
      id: 'spectral',
      title: 'Spectrals',
      fields: [
        { name: 'imageHost', label: 'Image host', type: 'enum' },
        {
          name: 'defaultSpectralIds',
          label: 'Default spectral ids',
          type: 'enum',
          options: ['All', 'Random', 'First track', 'None']
        },
        {
          name: 'defaultSpectralIdsForLossy',
          label: 'Default spectral ids for lossy masters',
          type: 'enum',
          options: ['All', 'Random', 'First track', 'None']
        }
      ]
    },
    {
      id: 'trackers',
      title: 'Trackers',
      description: 'Enable any combination of the supported trackers.',
      fields: [
        { name: 'redacted.enabled', label: 'Redacted enabled', type: 'bool' },
        { name: 'redacted.siteUrl', label: 'Redacted site URL', type: 'string' },
        { name: 'redacted.announceUrl', label: 'Redacted announce URL', type: 'string' },
        { name: 'redacted.apiKey', label: 'Redacted API key', type: 'string', sensitive: true },
        {
          name: 'redacted.sessionCookie',
          label: 'Redacted session cookie',
          type: 'string',
          sensitive: true
        },
        { name: 'redacted.coverImageHost', label: 'Cover Image Host', type: 'enum' },
        { name: 'separator', label: '', type: 'separator' },
        { name: 'orpheus.enabled', label: 'Orpheus enabled', type: 'bool' },
        { name: 'orpheus.siteUrl', label: 'Orpheus site URL', type: 'string' },
        { name: 'orpheus.announceUrl', label: 'Orpheus announce URL', type: 'string' },
        { name: 'orpheus.apiKey', label: 'Orpheus API key', type: 'string', sensitive: true },
        {
          name: 'orpheus.sessionCookie',
          label: 'Orpheus session cookie',
          type: 'string',
          sensitive: true
        },
        { name: 'orpheus.coverImageHost', label: 'Cover Image Host', type: 'enum' }
      ]
    },
    {
      id: 'metadataProviders',
      title: 'Metadata Providers',
      fields: [
        { name: 'musicBrainz.enabled', label: 'MusicBrainz enabled', type: 'bool' },
        { name: 'deezer.enabled', label: 'Deezer enabled', type: 'bool' },
        { name: 'requestTimeoutSeconds', label: 'Request timeout seconds', type: 'number' }
      ]
    },
    {
      id: 'torrentClient',
      title: 'Torrent Client',
      description: 'Connect to qBittorrent via its WebUI. Used for local seeding or a seedbox-hosted client.',
      fields: [
        { name: 'enabled', label: 'Enabled', type: 'bool' },
        { name: 'url', label: 'WebUI URL', type: 'url', description: 'e.g. http://127.0.0.1:8080' },
        { name: 'username', label: 'Username', type: 'string' },
        { name: 'password', label: 'Password', type: 'string', sensitive: true },
        {
          name: 'category',
          label: 'Category',
          type: 'string',
          description:
            'qBittorrent category for added torrents. Required with automatic torrent management, since that is where the save path comes from.'
        },
        {
          name: 'useAutoTMM',
          label: 'Automatic torrent management',
          type: 'bool',
          description:
            'Let qBittorrent place the data using the category save path. Turn off to pin the location below.'
        },
        {
          name: 'savePath',
          label: 'Save path',
          type: 'string',
          description:
            'Where qBittorrent looks for the release, as that machine sees it. With a seedbox, leave empty to reuse the remote path and set it only when qBittorrent sees a different mount.'
        },
        { name: 'startPaused', label: 'Start torrents paused', type: 'bool' }
      ]
    },
    {
      id: 'transfer',
      title: 'Seedbox',
      description: 'When enabled, release folders are uploaded over SFTP before torrents are injected.',
      fields: [
        { name: 'enabled', label: 'Enabled', type: 'bool' },
        { name: 'host', label: 'SFTP host', type: 'string' },
        { name: 'port', label: 'SFTP port', type: 'number' },
        { name: 'username', label: 'Username', type: 'string' },
        { name: 'password', label: 'Password', type: 'string', sensitive: true },
        {
          name: 'privateKeyPath',
          label: 'Private key path',
          type: 'file',
          description: 'Optional SSH private key. Used instead of or in addition to password.'
        },
        {
          name: 'remotePath',
          label: 'Remote path',
          type: 'string',
          description:
            'Destination directory on the seedbox. Also used as the torrent save path unless Torrent Client → Save path overrides it.'
        }
      ]
    },
    {
      id: 'naming',
      title: 'Templates',
      fields: [
        {
          name: 'albumDescriptionTemplateId',
          label: 'Album description template',
          type: 'enum',
          options: []
        },
        { name: 'releaseFolderTemplate', label: 'Release folder template', description: 'Fields: {artists}, {albumArtist}, {title}, {year}, {groupYear}, {editionTitle}, {label}, {catNo}, {upc}, {catNoOrUpc}, {source}, {format}, {encoding}, {releaseType}. Use {{ and }} for literal braces, for example {{{label}, {catNoOrUpc}}}.', type: 'string' },
        { name: 'trackFileTemplate', label: 'Track file template', description: 'Fields: {trackNumber}, {discNumber}, {title}, {artist}', type: 'string' },
        { name: 'multiDiscFolderTemplate', label: 'Multi-disc folder template', description: 'Fields: {discNumber}, {discTotal}', type: 'string' }
      ]
    },
    {
      id: 'cleanup',
      title: 'Cleanup Rules',
      fields: [
        {
          name: 'archiveDirectory',
          label: 'Archive music folders',
          description:
            'Optional. When you finish an upload, move music folders here. Useful to keep a local archive if you seed from a seedbox.',
          placeholder: 'Not set — keep music in the workspace',
          type: 'path'
        },
        {
          name: 'deleteOriginalFolder',
          label: 'Delete original folder',
          description:
            'Send the original source folder to the system Trash when you finish an upload. Archived folders, seeding copies, and the workspace are not affected.',
          type: 'bool'
        },
        {
          name: 'deleteTemporaryFiles',
          label: 'Delete workspace after seeding',
          description:
            'Remove the working copy once every transfer has finished. Skipped when nothing was transferred, since the workspace holds the only copy of the transcodes.',
          type: 'bool'
        },
        {
          name: 'deleteSpectralsAfterUpload',
          label: 'Delete spectrals after upload',
          description: 'Remove the generated spectral images once every upload has succeeded.',
          type: 'bool'
        }
      ]
    },
    {
      id: 'workflow',
      title: 'Workflow Toggles',
      fields: [
        { name: 'confirmBeforeWrites', label: 'Confirm before writes', type: 'bool' },
        {
          name: 'useUpcAsCatNo',
          label: 'Use UPC as catalogue number',
          description: 'When a catalogue number is missing, use the UPC/barcode instead.',
          type: 'bool'
        }
      ]
    }
  ]
}
