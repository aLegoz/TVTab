/// <reference types="vite/client" />

import type { Api } from '../electron/preload/index'

declare global {
  interface Window {
    api: Api
  }
}
