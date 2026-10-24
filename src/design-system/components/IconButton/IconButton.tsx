import { Tooltip } from 'radix-ui'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../../utils'
import { Button } from '../ui/button'

/**
 * Botão só com ícone: quadrado, com alvo de toque de 44 px, nome para o leitor de tela e um
 * tooltip de verdade (não o `title` do navegador) que aparece no hover e no foco do teclado.
 * O tooltip diz o que o botão faz, com o verbo na frente; o `label` (nome acessível) começa com
 * o mesmo texto e pode ter mais contexto. No toque não há hover: lá o nome acessível basta.
 */
export function IconButton({
  label,
  tooltip,
  children,
  className,
  variant = 'outline',
  ...props
}: Omit<ComponentProps<typeof Button>, 'aria-label' | 'size' | 'children'> & {
  /** O nome acessível do botão ("Diminuir: Limite de estandes por dia, Loja 07"). */
  label: string
  /** O texto curto do tooltip, igual ao começo do `label`. Sem ele, vale o `label`. */
  tooltip?: string
  children: ReactNode
}) {
  return (
    <Tooltip.Provider delayDuration={300} skipDelayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            type="button"
            size="icon"
            variant={variant}
            aria-label={label}
            className={cn(className)}
            {...props}
          >
            {children}
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            sideOffset={8}
            className="z-50 rounded-md bg-foreground px-3 py-2 text-sm text-background"
          >
            {tooltip ?? label}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}
