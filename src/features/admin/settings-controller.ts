import type { SignupMode } from '@/domain/access'
import type { Notice } from '@/features/booking/booking-controller'
import type { Failure } from '@/features/diagnostics/error-report'
import { describeFailure, toFailure } from '@/features/booking/messages'
import { inviteLink } from '@/features/access/routes'
import type { AccessGateway } from '@/lib/supabase/access-gateway'
import type { SignupSettings } from '@/lib/supabase/mappers'

export interface SettingsReady {
  status: 'ready'
  settings: SignupSettings
  /** O link de convite (/cadastro?codigo=…), quando existe um código. */
  inviteUrl: string | null
  confirmingRegenerate: boolean
  busy: boolean
  notice: Notice | null
}

export type SettingsState = { status: 'loading' } | ({ status: 'failed' } & Failure) | SettingsReady

export interface SettingsController {
  getState(): SettingsState
  subscribe(listener: () => void): () => void
  start(): Promise<void>
  setMode(mode: SignupMode): Promise<void>
  askRegenerate(): void
  keepCode(): void
  regenerate(): Promise<void>
  dismissNotice(): void
}

const MODE_NOTICES: Record<SignupMode, string> = {
  closed: 'Cadastro pela página fechado. Só você cadastra fornecedores.',
  invite: 'Cadastro com código ligado. Envie o link de convite a quem pode se cadastrar sozinho.',
  open: 'Cadastro livre ligado. Qualquer pessoa com e-mail e senha pode criar uma conta.',
}

export function createSettingsController(deps: {
  gateway: AccessGateway
  origin: string
}): SettingsController {
  const { gateway, origin } = deps

  let state: SettingsState = { status: 'loading' }
  const listeners = new Set<() => void>()
  let noticeId = 0

  function set(next: SettingsState): void {
    state = next
    for (const listener of [...listeners]) listener()
  }
  function ready(): SettingsReady | null {
    return state.status === 'ready' ? state : null
  }
  function patch(change: Partial<Omit<SettingsReady, 'status'>>): void {
    const current = ready()
    if (current !== null) set({ ...current, ...change })
  }
  function notify(kind: Notice['kind'], text: string): Notice {
    noticeId += 1
    return { id: noticeId, kind, text }
  }
  const withUrl = (settings: SignupSettings) => ({
    settings,
    inviteUrl: settings.inviteCode === null ? null : inviteLink(origin, settings.inviteCode),
  })

  async function start(): Promise<void> {
    set({ status: 'loading' })
    try {
      set({
        status: 'ready',
        ...withUrl(await gateway.signupSettings()),
        confirmingRegenerate: false,
        busy: false,
        notice: null,
      })
    } catch (error) {
      set({ status: 'failed', ...toFailure(error) })
    }
  }

  async function setMode(mode: SignupMode): Promise<void> {
    const current = ready()
    if (current === null || current.busy || current.settings.mode === mode) return
    patch({ busy: true, confirmingRegenerate: false })
    try {
      const result = await gateway.setSignupMode(mode)
      if (!result.ok) {
        patch({ busy: false, notice: notify('error', 'Só o administrador pode mudar isso.') })
        return
      }
      patch({
        busy: false,
        ...withUrl(result.settings),
        notice: notify('success', MODE_NOTICES[mode]),
      })
    } catch (error) {
      patch({ busy: false, notice: notify('error', describeFailure(error)) })
    }
  }

  function askRegenerate(): void {
    patch({ confirmingRegenerate: true })
  }

  function keepCode(): void {
    patch({ confirmingRegenerate: false })
  }

  async function regenerate(): Promise<void> {
    const current = ready()
    if (current === null || current.busy) return
    patch({ busy: true })
    try {
      const result = await gateway.regenerateInviteCode()
      if (!result.ok) {
        patch({
          busy: false,
          confirmingRegenerate: false,
          notice: notify('error', 'Só o administrador pode mudar isso.'),
        })
        return
      }
      patch({
        busy: false,
        confirmingRegenerate: false,
        ...withUrl(result.settings),
        notice: notify('success', 'Novo código gerado. O anterior deixou de valer.'),
      })
    } catch (error) {
      patch({ busy: false, notice: notify('error', describeFailure(error)) })
    }
  }

  function dismissNotice(): void {
    patch({ notice: null })
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    start,
    setMode,
    askRegenerate,
    keepCode,
    regenerate,
    dismissNotice,
  }
}
