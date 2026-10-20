import type { Preview } from '@storybook/react-vite'
import '../src/index.css'

const preview: Preview = {
  parameters: {
    // Violação de acessibilidade vira erro (no painel e em quem rodar as stories como teste).
    a11y: { test: 'error' },
    controls: { matchers: { date: /Date$/i } },
  },
}

export default preview
