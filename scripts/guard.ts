import * as designSystem from './guards/design-system.ts'
import * as disabledTests from './guards/disabled-tests.ts'
import type { GuardResult } from './guards/fs-utils.ts'
import * as migrations from './guards/migrations.ts'
import * as migrationsImmutable from './guards/migrations-immutable.ts'
import * as noServiceRole from './guards/no-service-role.ts'

const guards: { name: string; check: (root: string) => GuardResult }[] = [
  noServiceRole,
  designSystem,
  migrations,
  migrationsImmutable,
  disabledTests,
]

const root = process.cwd()
let failed = false

for (const guard of guards) {
  const { violations, notes = [] } = guard.check(root)
  for (const note of notes) console.log(`  aviso [${guard.name}] ${note}`)
  if (violations.length === 0) {
    console.log(`ok   ${guard.name}`)
    continue
  }
  failed = true
  console.error(`FAIL ${guard.name}`)
  for (const violation of violations) console.error(`     - ${violation}`)
}

process.exit(failed ? 1 : 0)
