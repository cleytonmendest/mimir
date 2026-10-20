import { execFileSync } from 'node:child_process'
import type { GuardResult } from './fs-utils.ts'

export const name = 'migrations-immutable'

/**
 * Migration que já existe na branch base nunca é editada, renomeada nem apagada:
 * quem já aplicou ficaria com um banco diferente do código. Mudou o schema? Nova migration.
 * Compara com a base informada em GUARD_BASE_REF (ex.: origin/main); sem base, avisa e pula.
 */
export function check(root: string, baseRef = process.env['GUARD_BASE_REF']): GuardResult {
  if (baseRef === undefined || baseRef === '') {
    return {
      violations: [],
      notes: ['sem GUARD_BASE_REF: imutabilidade de migrations não verificada'],
    }
  }

  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()

  let changes: string
  try {
    const mergeBase = git('merge-base', baseRef, 'HEAD')
    changes = git('diff', '--name-status', '--no-renames', mergeBase, '--', 'supabase/migrations')
  } catch {
    return {
      violations: [],
      notes: [`não foi possível comparar com ${baseRef}: verificação pulada`],
    }
  }

  const violations = changes
    .split('\n')
    .filter((line) => line !== '' && !line.startsWith('A'))
    .map((line) => {
      const [status, file] = line.split('\t')
      const what = status === 'D' ? 'apagada' : 'alterada'
      return `${file ?? line}: migration já existente foi ${what}; crie uma migration nova`
    })

  return { violations }
}
