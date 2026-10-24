import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { SearchField } from './SearchField'

const meta = {
  title: 'Design System/SearchField',
  component: SearchField,
  args: {
    label: 'Buscar por bairro ou nome',
    placeholder: 'Ex.: Leblon',
    value: '',
    onChange: () => undefined,
  },
} satisfies Meta<typeof SearchField>

export default meta
type Story = StoryObj<typeof meta>

export const Vazio: Story = {}
export const ComBusca: Story = { args: { value: 'gavea', summary: '2 de 31 mercados' } }
export const SemResultado: Story = {
  args: { value: 'zzz', summary: 'Nenhum mercado encontrado.' },
}

/** Digitando de verdade: o "x" aparece com texto e limpa. */
export const Interativo: Story = {
  render: (args) => {
    const [value, setValue] = useState('')
    return <SearchField {...args} value={value} onChange={setValue} />
  },
}
