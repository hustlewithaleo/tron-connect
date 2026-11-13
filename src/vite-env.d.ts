/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WC_PROJECT_ID: string
  readonly VITE_APP_URL?: string
  readonly VITE_TRONGRID_API_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
