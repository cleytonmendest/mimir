import { endpoint, json } from '../http.ts'
import { getSignupSettings } from '../supabase-api.ts'

/** O que a página pública /cadastro precisa saber: o modo. O código de convite nunca sai daqui. */
export const handleSignupStatus = endpoint(async (_req, deps) => {
  const settings = await getSignupSettings(deps)
  return json(200, { mode: settings.mode })
})
