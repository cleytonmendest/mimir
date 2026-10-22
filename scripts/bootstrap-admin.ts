import { pathToFileURL } from 'node:url'
import type { Deps } from '../supabase/functions/_shared/deps.ts'
import {
  createAuthUser,
  generateRecoveryToken,
  getProfileByEmail,
  setProfileRole,
} from '../supabase/functions/_shared/supabase-api.ts'
import { validateNameAndEmail } from '../supabase/functions/_shared/validate.ts'

/**
 * Cria o primeiro administrador de um ambiente novo (o app nunca cria administrador: toda conta
 * nasce fornecedora). Roda uma vez, na máquina de quem implanta, com a chave de serviço:
 *
 *   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/bootstrap-admin.ts --email dono@loja.com --nome "Maria Souza" --app-url https://agenda.exemplo
 *
 * Imprime o link para a pessoa escolher a própria senha; nenhuma senha passa por aqui. Rodar de
 * novo para o mesmo e-mail só gera outro link (serve também para quem perdeu o acesso).
 */

export type BootstrapResult =
  { ok: true; created: boolean; link: string } | { ok: false; message: string }

export async function bootstrapAdmin(
  deps: Deps,
  input: { email: string; fullName: string; appUrl: string },
): Promise<BootstrapResult> {
  const person = validateNameAndEmail(input)
  if (!person.ok) return { ok: false, message: person.message }
  const { email, fullName } = person.value

  const created = await createAuthUser(deps, { email, fullName, confirmed: true })
  if (!created.ok && created.reason !== 'EMAIL_EXISTS') {
    return { ok: false, message: 'O servidor recusou criar a conta.' }
  }

  const profile = await getProfileByEmail(deps, email)
  if (profile === null) {
    return { ok: false, message: 'A conta existe, mas o perfil dela não foi encontrado.' }
  }
  if (profile.deactivated_at !== null) {
    return { ok: false, message: 'Essa conta está desativada. Reative antes pelo app.' }
  }
  if (profile.role !== 'admin') await setProfileRole(deps, profile.id, 'admin')

  const token = await generateRecoveryToken(deps, email)
  const base = input.appUrl.replace(/\/+$/, '')
  return {
    ok: true,
    created: created.ok,
    link: `${base}/definir-senha?token=${encodeURIComponent(token)}`,
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

async function main(): Promise<void> {
  const supabaseUrl = process.env['SUPABASE_URL']
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY']
  const email = argument('email')
  const fullName = argument('nome')
  const appUrl = argument('app-url') ?? process.env['APP_URL']
  if (
    supabaseUrl === undefined ||
    serviceKey === undefined ||
    email === undefined ||
    fullName === undefined ||
    appUrl === undefined
  ) {
    console.error(
      'Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/bootstrap-admin.ts --email <e-mail> --nome "<nome>" --app-url <https://endereço-do-app>',
    )
    process.exitCode = 1
    return
  }

  const result = await bootstrapAdmin(
    {
      env: { supabaseUrl, anonKey: serviceKey, serviceKey },
      fetch: (input, init) => fetch(input, init),
      now: () => new Date(),
    },
    { email, fullName, appUrl },
  )
  if (!result.ok) {
    console.error(result.message)
    process.exitCode = 1
    return
  }
  console.log(
    `${result.created ? 'Administrador criado' : 'Conta já existia e agora é administradora'}.\n` +
      'Envie este link para a pessoa escolher a senha (vale por 24 horas, uma vez só):\n\n' +
      `${result.link}\n`,
  )
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
