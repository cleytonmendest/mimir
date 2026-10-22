import { useState } from 'react'
import { MIN_PASSWORD_LENGTH } from '@/domain/access'
import { Button } from '@/design-system/components/ui/button'
import { Input } from '@/design-system/components/ui/input'
import { Label } from '@/design-system/components/ui/label'

/**
 * Campo de senha com "Mostrar": no celular, digitar uma senha de 10 caracteres às cegas é pedir
 * para errar. Dizer o mínimo antes ajuda mais que reclamar depois.
 */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete = 'new-password',
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete?: 'new-password' | 'current-password'
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          required
          minLength={MIN_PASSWORD_LENGTH}
          aria-describedby={`${id}-hint`}
          value={value}
          onChange={(event) => {
            onChange(event.target.value)
          }}
        />
        <Button
          type="button"
          variant="outline"
          aria-pressed={visible}
          onClick={() => {
            setVisible((current) => !current)
          }}
        >
          {visible ? 'Ocultar' : 'Mostrar'}
        </Button>
      </div>
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">
        Pelo menos {MIN_PASSWORD_LENGTH} caracteres.
      </p>
    </div>
  )
}
