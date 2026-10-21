/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string | undefined
  readonly VITE_SUPABASE_ANON_KEY: string | undefined
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Versão do app, "0.0.0+commit". Definida em vite.config.ts. */
declare const __APP_VERSION__: string
