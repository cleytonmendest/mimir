import { useEffect, useState } from 'react'
import { formatInviteCode, type SignupMode } from '@/domain/access'
import { SegmentedControl } from '@/design-system/components/SegmentedControl/SegmentedControl'
import { Button } from '@/design-system/components/ui/button'
import { AccessLinkPanel } from '@/features/access/AccessLinkPanel'
import { SIGNUP_PATH } from '@/features/access/routes'
import { copyText, inviteMessage } from '@/features/access/share'
import { NoticeToast } from '@/features/booking/NoticeToast'
import type { AccessGateway } from '@/lib/supabase/access-gateway'
import {
  createSettingsController,
  type SettingsController,
  type SettingsReady,
} from './settings-controller'
import { useController } from './useController'

const MODES = [
  { value: 'closed', label: 'Fechado' },
  { value: 'invite', label: 'Com código' },
  { value: 'open', label: 'Livre' },
] as const satisfies readonly { value: SignupMode; label: string }[]

const MODE_HELP: Record<SignupMode, string> = {
  closed:
    'Só você cadastra fornecedores. A página de cadastro avisa que está fechada. É o jeito mais seguro e o padrão.',
  invite:
    'Quem tem o código de convite cria a própria conta pela página de cadastro. Você manda o link ou o código; o sistema não envia e-mail.',
  open: 'Qualquer pessoa com e-mail e senha cria uma conta e já pode reservar estandes. Use só por pouco tempo, e volte para "Com código" ou "Fechado" depois.',
}

/** Como a página pública de cadastro funciona. Cadastrar fornecedor pelo administrador vale sempre. */
export function SettingsView({
  gateway,
  origin = window.location.origin,
}: {
  gateway: AccessGateway
  origin?: string
}) {
  const [controller] = useState(() => createSettingsController({ gateway, origin }))
  const state = useController(controller)

  useEffect(() => {
    void controller.start()
  }, [controller])

  if (state.status === 'loading') {
    return (
      <p role="status" className="mt-6 text-muted-foreground">
        Carregando…
      </p>
    )
  }

  if (state.status === 'failed') {
    return (
      <div className="mt-6 grid gap-3">
        <p role="alert" className="text-destructive">
          {state.message}
        </p>
        <div>
          <Button
            onClick={() => {
              void controller.start()
            }}
          >
            Tentar de novo
          </Button>
        </div>
      </div>
    )
  }

  return (
    <>
      <section aria-labelledby="signup-title" className="mt-4 grid max-w-[640px] gap-4">
        <div>
          <h2 id="signup-title" className="font-display text-2xl leading-tight font-semibold">
            Cadastro pela página
          </h2>
          <p className="text-muted-foreground">
            Você sempre pode cadastrar fornecedores na aba Fornecedores. Aqui você decide se eles
            também podem se cadastrar sozinhos, pela página <strong>{SIGNUP_PATH}</strong>.
          </p>
        </div>
        <SegmentedControl
          label="Quem pode se cadastrar pela página"
          options={MODES}
          value={state.settings.mode}
          onChange={(mode) => {
            void controller.setMode(mode)
          }}
        />
        <p>{MODE_HELP[state.settings.mode]}</p>
        {state.settings.mode === 'open' && (
          <p role="note" className="rounded-xl border border-border bg-muted/40 p-4 font-semibold">
            Atenção: neste modo, qualquer pessoa na internet pode criar uma conta.
          </p>
        )}
        {state.settings.mode === 'invite' && <InvitePanel state={state} controller={controller} />}
      </section>
      <NoticeToast
        notice={state.notice}
        onClose={() => {
          controller.dismissNotice()
        }}
      />
    </>
  )
}

function InvitePanel({
  state,
  controller,
}: {
  state: SettingsReady
  controller: SettingsController
}) {
  const [copied, setCopied] = useState<string | null>(null)
  const code = state.settings.inviteCode
  if (code === null || state.inviteUrl === null) return null

  async function copyCode(value: string) {
    setCopied((await copyText(value)) ? 'Código copiado.' : 'Não deu para copiar. Anote o código.')
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 rounded-xl border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">Código de convite</p>
        <p
          aria-label="Código de convite"
          className="font-mono text-3xl font-semibold tracking-widest select-all"
        >
          {formatInviteCode(code)}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              void copyCode(formatInviteCode(code))
            }}
          >
            Copiar código
          </Button>
          {state.confirmingRegenerate ? null : (
            <Button
              variant="outline"
              disabled={state.busy}
              onClick={() => {
                controller.askRegenerate()
              }}
            >
              Gerar novo código
            </Button>
          )}
        </div>
        {copied !== null && (
          <p role="status" className="text-sm font-semibold">
            {copied}
          </p>
        )}
        {state.confirmingRegenerate && (
          <div role="group" aria-label="Confirmar o novo código" className="grid gap-2">
            <p>
              Gerar um novo código? O atual deixa de valer na hora. Quem já criou a conta continua
              com acesso.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="destructive"
                disabled={state.busy}
                onClick={() => {
                  void controller.regenerate()
                }}
              >
                Sim, gerar novo código
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  controller.keepCode()
                }}
              >
                Voltar
              </Button>
            </div>
          </div>
        )}
      </div>
      <AccessLinkPanel
        title="Link de convite"
        hint="O link abre a página de cadastro com o código já preenchido."
        url={state.inviteUrl}
        message={inviteMessage(state.inviteUrl, code)}
        copyLabel="Copiar link de convite"
        shareTitle="Convite para a Agenda de Degustações"
      />
    </div>
  )
}
