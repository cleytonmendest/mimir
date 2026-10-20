import type { Meta, StoryObj } from '@storybook/react-vite'
import { Input } from './input'

const meta = {
  title: 'Design System/Input',
  component: Input,
  args: { 'aria-label': 'E-mail', placeholder: 'voce@empresa.com' },
} satisfies Meta<typeof Input>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { args: { type: 'email' } }
export const Password: Story = {
  args: { type: 'password', 'aria-label': 'Senha', placeholder: '' },
}
export const Invalid: Story = { args: { 'aria-invalid': true, defaultValue: 'sem-arroba' } }
export const Disabled: Story = { args: { disabled: true } }
