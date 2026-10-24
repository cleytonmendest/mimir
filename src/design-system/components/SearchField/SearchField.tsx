import { Search, X } from 'lucide-react'
import { useId } from 'react'
import { IconButton } from '../IconButton/IconButton'
import { Input } from '../ui/input'
import { Label } from '../ui/label'

/**
 * Campo de busca de uma lista. Filtra enquanto se digita, então não há botão de buscar; o "x" limpa
 * (alvo de toque de 44px) e devolve o foco ao campo. `summary` é a frase do resultado ("3 de 31
 * mercados"): fica numa região viva (aria-live), que o leitor de tela anuncia sozinha a cada mudança. Não usa
 * role="status" de propósito: esse é o papel do aviso de sucesso, e as telas o procuram por ele.
 */
export function SearchField({
  label,
  value,
  onChange,
  placeholder,
  summary = null,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  summary?: string | null
}) {
  const id = useId()
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id={id}
          type="search"
          value={value}
          autoComplete="off"
          enterKeyHint="search"
          placeholder={placeholder}
          onChange={(event) => {
            onChange(event.target.value)
          }}
          // O "x" do próprio navegador some: o nosso tem alvo maior e o mesmo comportamento em todo lugar.
          className="px-10 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-cancel-button]:appearance-none"
        />
        {value !== '' && (
          <IconButton
            label="Limpar busca"
            variant="ghost"
            onClick={() => {
              onChange('')
              document.getElementById(id)?.focus()
            }}
            className="absolute top-0 right-0 text-muted-foreground hover:text-foreground"
          >
            <X aria-hidden className="size-4" />
          </IconButton>
        )}
      </div>
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {summary}
      </p>
    </div>
  )
}
