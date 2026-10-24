import { useState, type FocusEvent, type Ref } from 'react'
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
  error = null,
  onFocus,
  onBlur,
  inputRef,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete?: 'new-password' | 'current-password'
  /** O erro de agora (a tela só o mostra depois que a pessoa sai do campo). */
  error?: string | null
  onFocus?: () => void
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void
  inputRef?: Ref<HTMLInputElement>
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
          ref={inputRef}
          aria-invalid={error === null ? undefined : true}
          aria-describedby={error === null ? `${id}-hint` : `${id}-hint ${id}-error`}
          value={value}
          onFocus={onFocus}
          onBlur={onBlur}
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
      {error !== null && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
