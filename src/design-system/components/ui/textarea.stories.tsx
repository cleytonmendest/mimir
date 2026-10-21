import type { Meta, StoryObj } from '@storybook/react-vite'
import { Textarea } from './textarea'

const meta = {
  title: 'Design System/Textarea',
  component: Textarea,
  args: { 'aria-label': 'Observação', placeholder: 'Alguma observação sobre a visita?' },
} satisfies Meta<typeof Textarea>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const WithText: Story = { args: { defaultValue: 'Gôndola reposta, faltou o produto X.' } }
export const Invalid: Story = {
  args: { 'aria-label': 'Motivo', 'aria-invalid': true, placeholder: 'Por que não foi?' },
}
export const Disabled: Story = { args: { disabled: true } }
