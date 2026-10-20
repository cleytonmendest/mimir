import type { ButtonHTMLAttributes } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'danger'

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-brand-contrast hover:bg-brand-strong',
  secondary: 'bg-surface text-text border border-border hover:bg-surface-muted',
  danger: 'bg-danger text-danger-contrast hover:bg-danger-strong',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

/** Alvo de toque mínimo de 44px (min-h-11): o app é usado em pé, dentro de mercado. */
export function Button({
  variant = 'primary',
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  const base =
    'inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-base font-medium ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ' +
    'disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <button type={type} className={`${base} ${VARIANT_CLASSES[variant]} ${className}`} {...rest} />
  )
}
