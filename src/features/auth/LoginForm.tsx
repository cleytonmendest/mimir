import { useState, type FormEvent } from 'react'
import { Button } from '@/design-system/components/ui/button'
import { Input } from '@/design-system/components/ui/input'
import { Label } from '@/design-system/components/ui/label'
import type { AuthFailureCode } from '@/lib/supabase/auth'
import { useAuth } from './auth-context'

const MESSAGES: Record<AuthFailureCode, string> = {
  INVALID_CREDENTIALS: 'E-mail ou senha incorretos.',
  NETWORK: 'Sem conexão com o servidor. Verifique a internet e tente de novo.',
  UNKNOWN: 'Não foi possível entrar. Tente de novo.',
}

/** Sem "criar conta" nem "esqueci a senha" de propósito: quem cria os acessos é o líder. */
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
    <form
      onSubmit={(event) => {
        void submit(event)
      }}
      className="mt-6 grid gap-4"
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
      <Button type="submit" disabled={pending}>
        {pending ? 'Entrando…' : 'Entrar'}
      </Button>
    </form>
  )
}
