import type { Meta, StoryObj } from '@storybook/react-vite'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { InlineConfirm } from './InlineConfirm'

const meta = {
  title: 'Design System/InlineConfirm',
  component: InlineConfirm,
  args: {
    label: 'Confirmar cancelamento',
    title: 'Cancelar a reserva de seg 26/10 em Loja 07 - Leblon?',
    description: 'A vaga volta a ficar livre para outros fornecedores.',
    confirmLabel: 'Sim, cancelar',
    cancelLabel: 'Manter',
    onConfirm: () => undefined,
    onCancel: () => undefined,
  },
} satisfies Meta<typeof InlineConfirm>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const SemDescricao: Story = { args: { description: undefined } }
export const Ocupado: Story = { args: { busy: true } }
export const ComMotivo: Story = {
  args: {
    description: 'O sistema não avisa o fornecedor: combine com ele.',
    children: (
      <div className="grid gap-1.5">
        <Label htmlFor="motivo">Motivo (opcional)</Label>
        <Input id="motivo" />
      </div>
    ),
  },
}
