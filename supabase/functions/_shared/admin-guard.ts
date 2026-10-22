import type { Deps } from './deps.ts'
import { fail } from './http.ts'
import { callerIsAdmin, getCaller } from './supabase-api.ts'

/**
 * Só deixa passar um administrador ativo. 401 = não há login válido (o app deve pedir login de
 * novo); 403 = há login, mas não é administrador (fornecedor, ou administrador desativado).
 * O gateway já exige um JWT (verify_jwt); isto confere QUEM é, que ele não sabe.
 */
export async function requireAdmin(
  req: Request,
  deps: Deps,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const header = req.headers.get('Authorization') ?? ''
  const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1]
  if (token === undefined) {
    return { ok: false, response: fail(401, 'UNAUTHENTICATED', 'Entre de novo para continuar.') }
  }
  const caller = await getCaller(deps, token)
  if (caller === null) {
    return { ok: false, response: fail(401, 'UNAUTHENTICATED', 'Entre de novo para continuar.') }
  }
  if (!(await callerIsAdmin(deps, token))) {
    return { ok: false, response: fail(403, 'FORBIDDEN', 'Só o administrador pode fazer isso.') }
  }
  return { ok: true }
}
