import { handleAdminSupplierLink } from '../_shared/handlers/admin-supplier-link.ts'
import { realDeps } from '../_shared/runtime.ts'

Deno.serve((req) => handleAdminSupplierLink(req, realDeps()))
