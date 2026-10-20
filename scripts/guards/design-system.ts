import {
  isSource,
  isStoryFile,
  isTestFile,
  listFiles,
  readText,
  type GuardResult,
} from './fs-utils.ts'

export const name = 'design-system'

const TOKENS_FILE = 'src/design-system/tokens.css'

const RAW_CSS_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/
const PALETTE_CLASS = new RegExp(
  '\\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|divide|decoration|accent|caret|shadow|placeholder)-' +
    '(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)' +
    '(?:-\\d{2,3})?(?![\\w-])',
)
const ARBITRARY_COLOR = /\b[a-z]+(?:-[a-z]+)*-\[(?:#|rgb|hsl|oklch)/

const withoutCssComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * 1) todo componente do design system tem story (o Storybook é a vitrine e o teste visual);
 * 2) cor só existe em tokens.css: nada de hex em outro CSS, nem classe da paleta padrão, nem cor "inventada".
 */
export function check(root: string): GuardResult {
  const violations: string[] = []

  const componentFiles = listFiles(root, 'src/design-system/components')
  for (const file of componentFiles) {
    if (!file.endsWith('.tsx') || isStoryFile(file) || isTestFile(file)) continue
    const story = file.replace(/\.tsx$/, '.stories.tsx')
    if (!componentFiles.includes(story)) {
      violations.push(`${file}: componente sem story (crie ${story.split('/').pop() ?? 'a story'})`)
    }
  }

  for (const file of listFiles(root, 'src')) {
    if (file.endsWith('.css') && file !== TOKENS_FILE) {
      if (RAW_CSS_COLOR.test(withoutCssComments(readText(root, file)))) {
        violations.push(`${file}: cor fora de ${TOKENS_FILE}; use os tokens`)
      }
    }

    if (isSource(file) && !isTestFile(file)) {
      const content = readText(root, file)
      const palette = PALETTE_CLASS.exec(content)
      if (palette !== null) {
        violations.push(
          `${file}: classe "${palette[0]}" é da paleta padrão; use os tokens de tokens.css`,
        )
      }
      const arbitrary = ARBITRARY_COLOR.exec(content)
      if (arbitrary !== null) {
        violations.push(`${file}: cor arbitrária "${arbitrary[0]}..."; crie um token em tokens.css`)
      }
    }
  }

  return { violations }
}
