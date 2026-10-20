import { listFiles, readText, type GuardResult } from './fs-utils.ts'

export const name = 'migrations'

const MIGRATIONS_DIR = 'supabase/migrations'
const FILE_NAME = /^\d{14}_[a-z0-9_]+\.sql$/

/**
 * Regras estáticas do SQL (rodam sem banco). O comportamento real é testado pelo pgTAP:
 * - nome no formato do Supabase CLI, para a ordem de aplicação ser previsível;
 * - toda tabela criada liga o RLS na própria migration;
 * - ninguém desliga RLS nem dá privilégio ao papel anônimo.
 */
export function check(root: string): GuardResult {
  const files = listFiles(root, MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort()
  const violations: string[] = []
  let combined = ''

  for (const file of files) {
    const base = file.split('/').pop() ?? file
    if (!FILE_NAME.test(base)) {
      violations.push(`${file}: nome fora do padrão AAAAMMDDHHMMSS_descricao.sql`)
    }
    const sql = readText(root, file)
    combined += `\n${sql}`

    if (/disable\s+row\s+level\s+security/i.test(sql)) {
      violations.push(`${file}: desligar RLS não é permitido`)
    }
    if (/grant\s[^;]*\bto\b[^;]*\banon\b/i.test(sql)) {
      violations.push(`${file}: o papel anon não recebe privilégios (o app exige login)`)
    }
  }

  const tables = [
    ...combined.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)/gi),
  ]
  for (const [, table] of tables) {
    const enabled = new RegExp(
      `alter\\s+table\\s+(?:only\\s+)?(?:public\\.)?${table}\\s+enable\\s+row\\s+level\\s+security`,
      'i',
    )
    if (!enabled.test(combined)) {
      violations.push(
        `${MIGRATIONS_DIR}: tabela "${table ?? '?'}" criada sem "enable row level security"`,
      )
    }
  }

  return { violations }
}
