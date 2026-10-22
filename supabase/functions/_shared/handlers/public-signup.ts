import { endpoint, fail, json, readJsonObject, text } from '../http.ts'
import {
  countSignupAttempts,
  createAuthUser,
  getSignupSettings,
  purgeSignupAttempts,
  recordSignupAttempt,
  resendSignupConfirmation,
} from '../supabase-api.ts'
import {
  constantTimeEqual,
  normalizeInviteCode,
  sha256Hex,
  validateNameAndEmail,
  validatePassword,
} from '../validate.ts'

/** Tentativas por hora antes de recusar. O código de convite tem 40 bits: isto o torna inviável de chutar. */
export const MAX_ATTEMPTS_PER_IP_PER_HOUR = 20
export const MAX_ATTEMPTS_PER_EMAIL_PER_HOUR = 5
const HOUR_MS = 60 * 60 * 1000
const KEEP_ATTEMPTS_MS = 7 * 24 * HOUR_MS

function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded === undefined || forwarded === '' ? 'unknown' : forwarded
}

/**
 * Cadastro pela página pública, conforme o modo escolhido pelo administrador:
 *  - fechado: ninguém;
 *  - convite: quem tem o código (a conta já nasce confirmada: o código é a prova);
 *  - livre: qualquer pessoa, mas o e-mail precisa ser confirmado (exige SMTP configurado).
 * A conta sempre nasce fornecedora (o papel não vem do pedido).
 */
export const handlePublicSignup = endpoint(async (req, deps) => {
  const body = await readJsonObject(req)
  if (body === null) return fail(400, 'INVALID_INPUT', 'Pedido malformado.')

  const person = validateNameAndEmail({
    email: text(body['email']),
    fullName: text(body['fullName']),
  })
  if (!person.ok) return fail(400, 'INVALID_INPUT', person.message)
  const password = text(body['password'])
  const passwordProblem = validatePassword(password)
  if (passwordProblem !== null) return fail(422, 'WEAK_PASSWORD', passwordProblem)
  const { email, fullName } = person.value

  // Guarda só hash: nem o IP nem o e-mail de quem tentou ficam legíveis no banco.
  const ipHash = await sha256Hex(`${deps.env.serviceKey}:ip:${clientIp(req)}`)
  const emailHash = await sha256Hex(`${deps.env.serviceKey}:email:${email}`)
  const since = new Date(deps.now().getTime() - HOUR_MS)
  const [fromIp, fromEmail] = await Promise.all([
    countSignupAttempts(deps, 'ip_hash', ipHash, since),
    countSignupAttempts(deps, 'email_hash', emailHash, since),
  ])
  if (fromIp >= MAX_ATTEMPTS_PER_IP_PER_HOUR || fromEmail >= MAX_ATTEMPTS_PER_EMAIL_PER_HOUR) {
    return fail(429, 'RATE_LIMITED', 'Muitas tentativas. Espere um pouco e tente de novo.')
  }

  const record = (outcome: string) => recordSignupAttempt(deps, { ipHash, emailHash, outcome })

  const settings = await getSignupSettings(deps)
  if (settings.mode === 'closed') {
    await record('closed')
    return fail(
      403,
      'SIGNUP_CLOSED',
      'O cadastro está fechado. Peça ao responsável pelos mercados para cadastrar você.',
    )
  }

  if (settings.mode === 'invite') {
    const given = normalizeInviteCode(text(body['code']))
    const valid =
      settings.inviteCode !== null && (await constantTimeEqual(given, settings.inviteCode))
    if (!valid) {
      await record('wrong_code')
      return fail(403, 'INVALID_CODE', 'Esse código não vale. Confira com quem enviou o convite.')
    }
  }

  const confirmed = settings.mode === 'invite'
  const created = await createAuthUser(deps, { email, fullName, password, confirmed })
  if (!created.ok) {
    if (created.reason === 'WEAK_PASSWORD') {
      await record('weak_password')
      return fail(422, 'WEAK_PASSWORD', 'Essa senha é fraca demais. Escolha outra.')
    }
    await record('email_exists')
    // No modo livre qualquer um pode perguntar: não dizer se o e-mail já existe evita descobrir
    // quem é cliente. No de convite, quem pergunta já tem o código.
    return confirmed
      ? fail(409, 'EMAIL_EXISTS', 'Já existe uma conta com esse e-mail. Entre com a sua senha.')
      : json(202, { status: 'CONFIRM_EMAIL' })
  }

  await record('created')
  await purgeSignupAttempts(deps, new Date(deps.now().getTime() - KEEP_ATTEMPTS_MS))

  if (confirmed) return json(201, { status: 'CREATED' })
  await resendSignupConfirmation(deps, email)
  return json(202, { status: 'CONFIRM_EMAIL' })
})
