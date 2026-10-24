import { useState, type FormEvent } from 'react'
import { validatePassword } from '@/domain/access'
import { Button } from '@/design-system/components/ui/button'
import { AuthFailure, type AuthGateway } from '@/lib/supabase/auth'
import { PasswordField } from './PasswordField'

type Step =
  | 'intro'
  | 'checking'
  | 'form'
  | 'saving'
  | 'done'
  /** O link não vale mais: venceu, já foi usado ou veio cortado. */
  | 'invalid'

/**
 * A página que o fornecedor abre pelo link que o administrador enviou. O link só é trocado por
 * uma sessão depois do toque em "Continuar": programas que abrem links sozinhos (prévia do
 * WhatsApp, antivírus) não gastam o link, que só vale uma vez.
 */
export function SetPasswordPage({
  auth,
  token,
  onDone,
}: {
  auth: AuthGateway
  token: string | null
  /** Para onde ir quando a senha estiver definida (a tela principal, já logado). */
  onDone: () => void
}) {
  const [step, setStep] = useState<Step>(token === null ? 'invalid' : 'intro')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function redeem() {
    if (token === null) return
    setStep('checking')
    setError(null)
    try {
      setStep((await auth.redeemActivationToken(token)) === 'OK' ? 'form' : 'invalid')
    } catch (failure) {
      setStep('intro')
      setError(
        failure instanceof AuthFailure && failure.code === 'NETWORK'
          ? 'Sem conexão com o servidor. Verifique a internet e toque em Continuar de novo.'
          : 'Não foi possível abrir o link agora. Tente de novo.',
      )
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const problem = validatePassword(password)
    if (problem !== null) {
      setError(problem)
      return
    }
    setStep('saving')
    setError(null)
    try {
      await auth.setPassword(password)
      setStep('done')
      onDone()
    } catch (failure) {
      setStep('form')
      if (failure instanceof AuthFailure && failure.code === 'WEAK_PASSWORD') {
        setError('Essa senha não é aceita. Escolha outra.')
      } else if (failure instanceof AuthFailure && failure.code === 'NETWORK') {
        setError('Sem conexão com o servidor. Verifique a internet e tente de novo.')
      } else {
        setError('Não foi possível salvar a senha. Tente de novo.')
      }
    }
  }

  return (
    <section aria-labelledby="activation-title" className="grid gap-4">
      <h2 id="activation-title" className="font-display text-3xl font-semibold">
        Defina a sua senha
      </h2>

      {(step === 'intro' || step === 'checking') && (
        <>
          <p>
            Você foi convidado para a Agenda de Degustações, onde reserva os dias de estande nos
            mercados. Para começar, escolha uma senha.
          </p>
          <div>
            <Button
              disabled={step === 'checking'}
              onClick={() => {
                void redeem()
              }}
            >
              {step === 'checking' ? 'Abrindo…' : 'Continuar'}
            </Button>
          </div>
        </>
      )}

      {(step === 'form' || step === 'saving') && (
        <form
          noValidate
          onSubmit={(event) => {
            void save(event)
          }}
          className="grid gap-4"
        >
          <PasswordField
            id="activation-password"
            label="Escolha a sua senha"
            value={password}
            onChange={setPassword}
          />
          <Button type="submit" disabled={step === 'saving'}>
            {step === 'saving' ? 'Salvando…' : 'Salvar senha e entrar'}
          </Button>
        </form>
      )}

      {step === 'done' && (
        <p role="status" className="font-semibold">
          Senha definida. Entrando…
        </p>
      )}

      {step === 'invalid' && (
        <>
          <p role="alert">
            Este link venceu ou já foi usado. Peça ao administrador dos mercados um link novo.
          </p>
          <p>
            Se você já escolheu a senha,{' '}
            <a className="underline" href="/">
              entre aqui
            </a>
            .
          </p>
        </>
      )}

      {error !== null && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
