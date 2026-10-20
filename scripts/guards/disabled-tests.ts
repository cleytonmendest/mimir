import { isSource, isTestFile, listFiles, readText, type GuardResult } from './fs-utils.ts'

export const name = 'disabled-tests'

// it.only / it.skip / xit / fit ... (test.fixme é permitido: é explícito e aparece no relatório)
const DISABLED =
  /\b(?:it|test|describe)\.(?:only|skip)\b|\b(?:xit|xtest|xdescribe|fit|fdescribe)\s*\(/

/** Silenciar um teste para o CI passar é a forma mais comum de quebrar um guard rail. */
export function check(root: string): GuardResult {
  const violations: string[] = []
  for (const file of [...listFiles(root, 'src'), ...listFiles(root, 'e2e')]) {
    if (!isSource(file) || !isTestFile(file)) continue
    const match = DISABLED.exec(readText(root, file))
    if (match !== null) {
      violations.push(
        `${file}: teste desligado com "${match[0].trim()}"; conserte o teste ou apague-o de propósito`,
      )
    }
  }
  return { violations }
}
