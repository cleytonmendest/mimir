import type { Meta, StoryObj } from '@storybook/react-vite'
import { Input } from './input'
import { Label } from './label'

const meta = {
  title: 'Design System/Label',
  component: Label,
} satisfies Meta<typeof Label>

export default meta
type Story = StoryObj<typeof meta>

export const WithField: Story = {
  render: () => (
    <div className="grid gap-2">
      <Label htmlFor="mercado">Mercado</Label>
      <Input id="mercado" />
    </div>
  ),
}
