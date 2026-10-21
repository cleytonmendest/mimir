import type { Meta, StoryObj } from '@storybook/react-vite'
import { SyncStatus } from './SyncStatus'

const meta = {
  title: 'Design System/SyncStatus',
  component: SyncStatus,
  args: { tone: 'ok', title: 'Tudo enviado' },
} satisfies Meta<typeof SyncStatus>

export default meta
type Story = StoryObj<typeof meta>

export const Ok: Story = { args: { detail: 'Último envio às 10:32.' } }
export const Working: Story = { args: { tone: 'working', title: 'Enviando…' } }
export const Waiting: Story = {
  args: {
    tone: 'waiting',
    title: '3 registros para enviar',
    detail: 'Sem conexão. Tentando de novo às 10:35.',
    action: { label: 'Enviar agora', onClick: () => undefined },
  },
}
export const Problem: Story = {
  args: {
    tone: 'problem',
    title: 'Entre de novo para enviar',
    detail: 'Seus 2 registros estão guardados neste aparelho.',
  },
}
