import { handleSignupStatus } from '../_shared/handlers/signup-status.ts'
import { realDeps } from '../_shared/runtime.ts'

Deno.serve((req) => handleSignupStatus(req, realDeps()))
