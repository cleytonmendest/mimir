/** Tudo que um handler precisa do mundo de fora, para os testes poderem trocar por um falso. */
export interface Env {
  /** URL do Supabase vista de dentro da função (a do gateway, não a pública do app). */
  supabaseUrl: string
  /** Chave pública (a mesma do app). Serve para validar o login de quem chama. */
  anonKey: string
  /** Chave de serviço: ignora o RLS. Só existe aqui, nunca vai para o navegador. */
  serviceKey: string
}

export interface Deps {
  env: Env
  fetch: typeof fetch
  now: () => Date
}
