import { composeStories, setProjectAnnotations } from '@storybook/react-vite'
import { render } from '@testing-library/react'
import axe from 'axe-core'
import type { ComponentType } from 'react'
import { describe, expect, it } from 'vitest'
import * as previewAnnotations from '../../.storybook/preview'

/**
 * Toda story de todo componente é renderizada e passa pelo axe (acessibilidade).
 * Story que quebra, ou componente que fica inacessível, derruba o CI.
 * (Contraste de cor não é checado aqui: o jsdom não calcula layout. Isso fica a cargo
 * do painel a11y do Storybook e de revisão visual.)
 */
setProjectAnnotations([previewAnnotations])

const modules = import.meta.glob('./**/*.stories.tsx', { eager: true })

describe('stories do design system', () => {
  it('existe pelo menos uma story', () => {
    expect(Object.keys(modules).length).toBeGreaterThan(0)
  })

  for (const [file, module] of Object.entries(modules)) {
    const stories = composeStories(
      module as Parameters<typeof composeStories>[0],
    ) as unknown as Record<string, ComponentType>

    describe(file, () => {
      for (const [name, Story] of Object.entries(stories)) {
        it(`${name} renderiza sem violações de acessibilidade`, async () => {
          const { container } = render(<Story />)
          expect(container).not.toBeEmptyDOMElement()

          const results = await axe.run(container, {
            rules: { 'color-contrast': { enabled: false } },
          })
          expect(results.violations.map((violation) => violation.id)).toEqual([])
        })
      }
    })
  }
})
