import type { ReactNode } from 'react'
import { AppTitle } from './AppTitle'

/**
 * A moldura das telas de quem ainda não entrou (login, link de ativação, cadastro): o nome do app e
 * um cartão estreito no meio da página, em vez de campos esticados pela largura toda do computador.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md pt-4 sm:pt-12">
      <AppTitle centered />
      <div className="relative mt-6 overflow-hidden rounded-xl border border-border bg-card p-5 pt-6 sm:p-6 sm:pt-7">
        <div aria-hidden className="absolute inset-x-0 top-0 h-1 bg-primary" />
        {children}
      </div>
    </div>
  )
}
