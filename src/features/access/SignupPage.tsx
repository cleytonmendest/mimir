import { useEffect, useState, type FormEvent } from 'react'
import {
  formatInviteCode,
  validatePassword,
  validateSupplierInput,
  type SignupMode,
} from '@/domain/access'
import { Button } from '@/design-system/components/ui/button'
import { Input } from '@/design-system/components/ui/input'
import { Label } from '@/design-system/components/ui/label'
import { describeFailure } from '@/features/booking/messages'
import type { AccessGateway, SignUpRefusal } from '@/lib/supabase/access-gateway'
import type { AuthGateway } from '@/lib/supabase/auth'
import { PasswordField } from './PasswordField'

const REFUSALS: Record<SignUpRefusal | 'UNRECOGNIZED', string> = {
  SIGNUP_CLOSED: 'O cadastro acabou de ser fechado. Peça ao responsável pelos mercados.',
  INVALID_CODE: 'Esse código não vale. Confira com quem enviou o convite.',
  EMAIL_EXISTS: 'Já existe uma conta com esse e-mail. Entre com a sua senha.',
  WEAK_PASSWORD: 'Essa senha é fraca demais. Escolha outra.',
  RATE_LIMITED: 'Muitas tentativas. Espere um pouco e tente de novo.',
  INVALID_INPUT: 'Confira os dados e tente de novo.',
  UNRECOGNIZED: 'Não foi possível criar a conta agora. Tente de novo.',
}

type Loaded = { status: 'failed'; message: string } | { status: 'ready'; mode: SignupMode }
type Load = { status: 'loading' } | Loaded

/**
 * A página pública de cadastro de fornecedor. O que ela aceita depende do modo que o administrador
 * escolheu: fechado (só avisa), com código de convite, ou livre.
 */
export function SignupPage({
  access,
  auth,
  code,
  onDone,
}: {
  access: AccessGateway
  auth: AuthGateway
  /** O código que veio no link de convite (?codigo=), ou ''. */
  code: string
  /** Para onde ir depois de criar a conta e entrar (a tela principal). */
  onDone: () => void
}) {
  const [attempt, setAttempt] = useState(0)
  // O resultado guarda a tentativa a que pertence: enquanto não chega o da tentativa atual, é "carregando".
  const [result, setResult] = useState<{ attempt: number; value: Loaded } | null>(null)
  const load: Load = result?.attempt === attempt ? result.value : { status: 'loading' }

  useEffect(() => {
    let active = true
    access.signupStatus().then(
      (mode) => {
        if (active) setResult({ attempt, value: { status: 'ready', mode } })
      },
      (error: unknown) => {
        if (active)
          setResult({ attempt, value: { status: 'failed', message: describeFailure(error) } })
      },
    )
    return () => {
      active = false
    }
  }, [access, attempt])

  return (
    <section aria-labelledby="signup-page-title" className="mt-6 grid max-w-[480px] gap-4">
      <h2 id="signup-page-title" className="font-display text-3xl font-semibold">
        Cadastro de fornecedor
      </h2>

      {load.status === 'loading' && (
        <p role="status" className="text-muted-foreground">
          Carregando…
        </p>
      )}

      {load.status === 'failed' && (
        <>
          <p role="alert" className="text-destructive">
            {load.message}
          </p>
          <div>
            <Button
              onClick={() => {
                setAttempt((count) => count + 1)
              }}
            >
              Tentar de novo
            </Button>
          </div>
        </>
      )}

      {load.status === 'ready' && load.mode === 'closed' && (
        <>
          <p role="status">
            O cadastro está fechado. Peça ao responsável pelos mercados para cadastrar você.
          </p>
          <p>
            Já tem conta?{' '}
            <a className="underline" href="/">
              Entre aqui
            </a>
            .
          </p>
        </>
      )}

      {load.status === 'ready' && load.mode !== 'closed' && (
        <SignupForm
          mode={load.mode}
          initialCode={code}
          access={access}
          auth={auth}
          onDone={onDone}
          onClosed={() => {
            setResult({ attempt, value: { status: 'ready', mode: 'closed' } })
          }}
        />
      )}
    </section>
  )
}

function SignupForm({
  mode,
  initialCode,
  access,
  auth,
  onDone,
  onClosed,
}: {
  mode: Exclude<SignupMode, 'closed'>
  initialCode: string
  access: AccessGateway
  auth: AuthGateway
  onDone: () => void
  onClosed: () => void
}) {
  const [inviteCode, setInviteCode] = useState(
    initialCode === '' ? '' : formatInviteCode(initialCode),
  )
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmEmail, setConfirmEmail] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const person = validateSupplierInput({ fullName, email })
    if (!person.ok) {
      setError(person.message)
      return
    }
    const passwordProblem = validatePassword(password)
    if (passwordProblem !== null) {
      setError(passwordProblem)
      return
    }
    if (mode === 'invite' && inviteCode.trim() === '') {
      setError('Informe o código de convite.')
      return
    }

    setPending(true)
    setError(null)
    try {
      const result = await access.signUp({
        ...person.value,
        password,
        ...(mode === 'invite' ? { code: inviteCode } : {}),
      })
      if (!result.ok) {
        if (result.code === 'SIGNUP_CLOSED') onClosed()
        setError(REFUSALS[result.code])
        return
      }
      if (result.status === 'CONFIRM_EMAIL') {
        setConfirmEmail(person.value.email)
        return
      }
      // Conta criada e confirmada: entra já, com a senha que acabou de escolher.
      try {
        await auth.signIn(person.value.email, password)
        onDone()
      } catch {
        setError('Conta criada! Mas não conseguimos entrar agora. Use "Entre aqui", abaixo.')
      }
    } catch (failure) {
      setError(describeFailure(failure))
    } finally {
      setPending(false)
    }
  }

  if (confirmEmail !== null) {
    return (
      <>
        <p role="status" className="font-semibold">
          Quase lá! Enviamos uma mensagem para {confirmEmail}.
        </p>
        <p>Abra o e-mail e confirme o endereço. Depois é só entrar com a sua senha.</p>
        <p>
          <a className="underline" href="/">
            Ir para a entrada
          </a>
        </p>
      </>
    )
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void submit(event)
      }}
      className="grid gap-4"
    >
      <p>
        {mode === 'invite'
          ? 'Use o código de convite que você recebeu para criar a sua conta e reservar estandes de degustação.'
          : 'Crie a sua conta para reservar estandes de degustação nos mercados.'}
      </p>
      {mode === 'invite' && (
        <div className="grid gap-1.5">
          <Label htmlFor="signup-code">Código de convite</Label>
          <Input
            id="signup-code"
            value={inviteCode}
            autoComplete="off"
            autoCapitalize="characters"
            className="font-mono tracking-widest uppercase"
            onChange={(event) => {
              setInviteCode(event.target.value)
            }}
          />
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="signup-name">Nome ou empresa</Label>
        <Input
          id="signup-name"
          value={fullName}
          autoComplete="organization"
          onChange={(event) => {
            setFullName(event.target.value)
          }}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="signup-email">E-mail</Label>
        <Input
          id="signup-email"
          type="email"
          value={email}
          autoComplete="email"
          onChange={(event) => {
            setEmail(event.target.value)
          }}
        />
      </div>
      <PasswordField
        id="signup-password"
        label="Escolha uma senha"
        value={password}
        onChange={setPassword}
      />
      {error !== null && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? 'Criando…' : 'Criar conta'}
      </Button>
      <p>
        Já tem conta?{' '}
        <a className="underline" href="/">
          Entre aqui
        </a>
        .
      </p>
    </form>
  )
}
