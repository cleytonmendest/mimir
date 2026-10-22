import { requireAdmin } from '../admin-guard.ts'
import { endpoint, fail, json, readJsonObject, text } from '../http.ts'
import { createAuthUser, deleteAuthUser, generateRecoveryToken } from '../supabase-api.ts'
import { validateNameAndEmail } from '../validate.ts'

/**
 * O administrador cadastra um fornecedor (nome e e-mail). A conta nasce confirmada e sem senha; a
 * resposta traz o token do link de ativação, e o app monta o link (/definir-senha?token=...) que o
 * administrador envia. Nenhuma senha passa pelo administrador.
 */
export const handleAdminCreateSupplier = endpoint(async (req, deps) => {
  const guard = await requireAdmin(req, deps)
  if (!guard.ok) return guard.response

  const body = await readJsonObject(req)
  if (body === null) return fail(400, 'INVALID_INPUT', 'Pedido malformado.')
  const input = validateNameAndEmail({
    email: text(body['email']),
    fullName: text(body['fullName']),
  })
  if (!input.ok) return fail(400, 'INVALID_INPUT', input.message)

  const created = await createAuthUser(deps, { ...input.value, confirmed: true })
  if (!created.ok) {
    return fail(409, 'EMAIL_EXISTS', 'Já existe uma conta com esse e-mail.')
  }

  let token: string
  try {
    token = await generateRecoveryToken(deps, input.value.email)
  } catch (error) {
    // Conta sem link não serve a ninguém e travaria o e-mail para uma nova tentativa.
    await deleteAuthUser(deps, created.id)
    throw error
  }

  return json(201, {
    supplier: { id: created.id, email: input.value.email, fullName: input.value.fullName },
    token,
  })
})
