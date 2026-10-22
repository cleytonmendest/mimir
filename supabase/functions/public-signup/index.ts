import { handlePublicSignup } from '../_shared/handlers/public-signup.ts'
import { realDeps } from '../_shared/runtime.ts'

Deno.serve((req) => handlePublicSignup(req, realDeps()))
