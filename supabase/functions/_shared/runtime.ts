import type { Deps } from './deps.ts'

declare const Deno: { env: { get(name: string): string | undefined } }

/** As dependências de verdade, no Deno do Supabase. As variáveis chegam prontas ao runtime. */
export function realDeps(): Deps {
  const read = (name: string): string => {
    const value = Deno.env.get(name)
    if (value === undefined || value === '') throw new Error(`Variável ${name} não definida`)
    return value
  }
  return {
    env: {
      supabaseUrl: read('SUPABASE_URL'),
      anonKey: read('SUPABASE_ANON_KEY'),
      serviceKey: read('SUPABASE_SERVICE_ROLE_KEY'),
    },
    fetch: (input, init) => fetch(input, init),
    now: () => new Date(),
  }
}
