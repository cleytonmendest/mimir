import { useState, type FormEvent } from 'react'
import { Button } from '@/design-system/components/ui/button'
import { Input } from '@/design-system/components/ui/input'
import { Label } from '@/design-system/components/ui/label'
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
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<AuthFailureCode | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    const result = await signIn(email.trim(), password)
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
        onSubmit={(event) => {
          void submit(event)
        }}
        className="grid gap-4"
      >
        <div className="grid gap-2">
          <Label htmlFor="login-email">E-mail</Label>
          <Input
            id="login-email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
            }}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="login-password">Senha</Label>
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
            }}
          />
        </div>
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
