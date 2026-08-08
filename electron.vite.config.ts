import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import solid from 'vite-plugin-solid'

// The main process builds to CommonJS, but these three ship as ESM only —
// their package `exports` declare an `import` condition and no `require` one,
// so a `require()` of them cannot even resolve. Externalizing them would build
// cleanly and then fail at runtime in the packaged app. Bundling inlines them
// instead.
const BUNDLE_ESM_ONLY = ['create-torrent', 'bencode', 'junk']

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: BUNDLE_ESM_ONLY })],
    resolve: {
      alias: {
        '@main': resolve('src/main'),
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [solid()]
  }
})
