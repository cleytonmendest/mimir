import { handleAdminCreateSupplier } from '../_shared/handlers/admin-create-supplier.ts'
import { realDeps } from '../_shared/runtime.ts'

Deno.serve((req) => handleAdminCreateSupplier(req, realDeps()))
