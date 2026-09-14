import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/main/core/**/__tests__/**/*.test.ts',
      'src/main/services/__tests__/**/*.test.ts',
      'src/renderer/**/__tests__/**/*.test.ts',
      'src/shared/**/__tests__/**/*.test.ts'
    ],
    exclude: ['node_modules', 'out', 'dist']
  },
  resolve: {
    alias: {
      '@main': resolve('src/main'),
      'solid-js': resolve('node_modules/solid-js/dist/solid.js'),
      '@shared': resolve('src/shared')
    }
  }
})
