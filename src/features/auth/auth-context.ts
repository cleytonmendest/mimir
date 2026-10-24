import { createContext, useContext } from 'react'
import type { AuthFailureCode } from '@/lib/supabase/auth'
import type { UserProfile } from '@/lib/supabase/mappers'

export type SignInResult = { ok: true } | { ok: false; code: AuthFailureCode }

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; profile: UserProfile }
  | { status: 'failed'; message: string; details: string | null }

export interface AuthContextValue {
  state: AuthState
  signIn: (email: string, password: string) => Promise<SignInResult>
  signOut: () => Promise<void>
  /** Tenta de novo depois de uma falha (sem internet, perfil que ainda não chegou). */
  retry: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (value === null) throw new Error('useAuth só funciona dentro de <AuthProvider>')
  return value
}
