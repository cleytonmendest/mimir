import { useState, type FormEvent } from 'react'
import { validateEmail, validateLoginPassword } from '@/domain/access'
import { TextField } from '@/design-system/components/TextField/TextField'
import { Button } from '@/design-system/components/ui/button'
import { checkAll, useValidatedField } from '@/features/forms/useValidatedField'
import type { AuthFailureCode } from '@/lib/supabase/auth'
import { useAuth } from './auth-context'

const MESSAGES: Record<AuthFailureCode, string> = {
  INVALID_CREDENTIALS: 'E-mail ou senha incorretos.',
  NETWORK: 'Sem conexão com o servidor. Verifique a internet e tente de novo.',
  WEAK_PASSWORD: 'Não foi possível entrar. Tente de novo.',
  UNKNOWN: 'Não foi possível entrar. Tente de novo.',
}

/**
 * Sem "esqueci a senha" de propósito: quem perdeu o acesso pede ao administrador um novo link. A
 * página de cadastro (/cadastro) é endereço próprio, que o administrador compartilha quando quer.
 */
export function LoginForm() {
  const { signIn } = useAuth()
  const email = useValidatedField(validateEmail)
  const password = useValidatedField(validateLoginPassword)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<AuthFailureCode | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!checkAll([email, password])) return
    setPending(true)
    setError(null)
    const result = await signIn(email.value.trim(), password.value)
    setPending(false)
    if (!result.ok) setError(result.code)
  }

  return (
    <div className="grid gap-5">
      <div>
        <h2 className="font-display text-3xl leading-tight font-semibold">Entrar</h2>
        <p className="text-muted-foreground">Reserve estandes de degustação nos mercados.</p>
      </div>
      <form
        noValidate
        onSubmit={(event) => {
          void submit(event)
        }}
        className="grid gap-4"
      >
        <TextField
          id="login-email"
          label="E-mail"
          type="email"
          autoComplete="username"
          required
          value={email.value}
          error={email.error}
          inputRef={email.ref}
          onChange={(event) => {
            email.change(event.target.value)
          }}
          onFocus={email.focus}
          onBlur={email.blur}
        />
        <TextField
          id="login-password"
          label="Senha"
          type="password"
          autoComplete="current-password"
          required
          value={password.value}
          error={password.error}
          inputRef={password.ref}
          onChange={(event) => {
            password.change(event.target.value)
          }}
          onFocus={password.focus}
          onBlur={password.blur}
        />
        {error !== null && (
          <p role="alert" className="text-destructive">
            {MESSAGES[error]}
          </p>
        )}
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">
        Perdeu o acesso? Peça um novo link ao administrador dos mercados.
      </p>
    </div>
  )
}
