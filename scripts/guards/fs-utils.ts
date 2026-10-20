import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface GuardResult {
  violations: string[]
  notes?: string[]
}

const IGNORED_DIRS = new Set(['node_modules', 'dist', '.git', 'storybook-static', 'coverage'])

/** Lista arquivos (caminhos relativos, com "/") dentro de root/dir. Pasta inexistente = lista vazia. */
export function listFiles(root: string, dir = ''): string[] {
  const absolute = join(root, dir)
  if (!existsSync(absolute)) return []

  const found: string[] = []
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const relative = dir === '' ? entry.name : `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) found.push(...listFiles(root, relative))
    } else {
      found.push(relative)
    }
  }
  return found
}

export function readText(root: string, relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8')
}

export const isTestFile = (file: string) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
export const isStoryFile = (file: string) => /\.stories\.[jt]sx?$/.test(file)
export const isSource = (file: string) => /\.[cm]?[jt]sx?$/.test(file)
