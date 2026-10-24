import { Button } from '@/design-system/components/ui/button'

/** O aviso de que o formulário abriu com o que foi digitado antes, e a saída para começar do zero. */
export function DraftNotice({ onDiscard }: { onDiscard: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
      <span>Recuperamos o que você tinha digitado.</span>
      <Button type="button" variant="ghost" onClick={onDiscard}>
        Descartar rascunho
      </Button>
    </div>
  )
}
