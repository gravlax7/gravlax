import type { GravlaxAPI } from '../../preload/index'

declare global {
  interface Window {
    gravlax: GravlaxAPI
  }
}

export {}
