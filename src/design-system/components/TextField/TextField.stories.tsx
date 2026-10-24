import type { Meta, StoryObj } from '@storybook/react-vite'
import { TextField } from './TextField'

const meta = {
  title: 'Design System/TextField',
  component: TextField,
  args: { id: 'campo', label: 'Nome ou empresa' },
} satisfies Meta<typeof TextField>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const ComDica: Story = { args: { label: 'Senha', hint: 'Pelo menos 10 caracteres.' } }
export const ComErro: Story = { args: { error: 'Informe o nome do fornecedor.' } }
export const ComDicaEErro: Story = {
  args: {
    label: 'Senha',
    hint: 'Pelo menos 10 caracteres.',
    error: 'A senha precisa ter pelo menos 10 caracteres.',
  },
}
