import { requireAdmin } from '../admin-guard.ts'
import { endpoint, fail, json, readJsonObject, text } from '../http.ts'
import { generateRecoveryToken, getProfile } from '../supabase-api.ts'
import { isUuid } from '../validate.ts'

/**
 * Novo link de ativação para um fornecedor que perdeu o acesso (ou deixou o primeiro vencer). O
 * link anterior continua valendo até vencer ou ser usado; gerar outro não mexe na senha.
 */
export const handleAdminSupplierLink = endpoint(async (req, deps) => {
  const guard = await requireAdmin(req, deps)
  if (!guard.ok) return guard.response

  const body = await readJsonObject(req)
  const supplierId = text(body?.['supplierId'])
  if (!isUuid(supplierId)) return fail(400, 'INVALID_INPUT', 'Fornecedor inválido.')

  const profile = await getProfile(deps, supplierId)
  if (profile === null || profile.role !== 'supplier' || profile.email === null) {
    return fail(404, 'NOT_FOUND', 'Fornecedor não encontrado.')
  }
  if (profile.deactivated_at !== null) {
    return fail(
      409,
      'DEACTIVATED',
      'Esse fornecedor está desativado. Reative antes de gerar o link.',
    )
  }

  return json(200, { token: await generateRecoveryToken(deps, profile.email) })
})
