import { useId, type ComponentProps, type Ref } from 'react'
import { Input } from '../ui/input'
import { Label } from '../ui/label'

/**
 * Rótulo, campo, dica e erro, ligados do jeito que o leitor de tela espera: o rótulo está sempre
 * à vista (o placeholder só dá exemplo), e o erro aparece logo abaixo, anunciado e ligado ao campo.
 */
export function TextField({
  id,
  label,
  hint,
  error = null,
  inputRef,
  ...input
}: Omit<ComponentProps<typeof Input>, 'id' | 'ref'> & {
  id: string
  label: string
  /** Orientação que vale antes de errar ("Pelo menos 10 caracteres."). */
  hint?: string
  error?: string | null
  inputRef?: Ref<HTMLInputElement>
}) {
  const hintId = useId()
  const errorId = useId()
  const describedBy = [hint === undefined ? null : hintId, error === null ? null : errorId]
    .filter((part) => part !== null)
    .join(' ')

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        ref={inputRef}
        aria-invalid={error === null ? undefined : true}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        {...input}
      />
      {hint !== undefined && (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {error !== null && (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
