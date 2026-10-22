import { listFiles, readText, type GuardResult } from './fs-utils.ts'

export const name = 'no-service-role'

// "service_role" escrito, a mesma palavra em base64 (cola de JWT) e o formato novo de chave secreta.
const FORBIDDEN = [/service_role/i, /c2VydmljZV9yb2xl/, /sb_secret_/]

/**
 * A chave de servidor ignora o RLS. Se ela chegar ao front, qualquer pessoa lê e apaga tudo.
 * Vale para o código que vai para o navegador (src, index.html, vite.config.ts) e todo arquivo .env.
 * Inclui o .env.example: quem o copia para .env.local leva junto cada comentário dele, e um que cite
 * a chave faria este guard (e o hook de pre-commit) barrar a máquina de quem só seguiu o README.
 */
export function check(root: string): GuardResult {
  const files = [
    ...listFiles(root, 'src'),
    ...['index.html', 'vite.config.ts'],
    ...listFiles(root).filter((file) => /^\.env(\..+)?$/.test(file)),
  ]

  const violations: string[] = []
  for (const file of new Set(files)) {
    let content: string
    try {
      content = readText(root, file)
    } catch {
      continue
    }
    const hit = FORBIDDEN.find((pattern) => pattern.test(content))
    if (hit !== undefined) {
      violations.push(
        `${file}: chave de servidor (service role) não pode existir no front (${hit.source})`,
      )
    }
  }
  return { violations }
}
