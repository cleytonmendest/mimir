import type { Meta, StoryObj } from '@storybook/react-vite'
import { Toast } from './Toast'

const meta = {
  title: 'Design System/Toast',
  component: Toast,
  args: { kind: 'success', children: 'Reserva confirmada.', onClose: () => undefined },
} satisfies Meta<typeof Toast>

export default meta
type Story = StoryObj<typeof meta>

export const Sucesso: Story = {}
export const Informacao: Story = {
  args: { kind: 'info', children: 'Limite do Mercado Central: 4 estandes por dia.' },
}
export const Erro: Story = {
  args: {
    kind: 'error',
    children: 'Não deu: a última vaga deste dia acabou de ser ocupada. Escolha outro dia.',
  },
}
