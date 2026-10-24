import { SearchField } from '@/design-system/components/SearchField/SearchField'
import type { MarketSearch } from './useMarketSearch'

/** O campo de busca das listas de mercado: o mesmo texto e o mesmo comportamento em todas. */
export function MarketSearchField({ search }: { search: MarketSearch }) {
  if (!search.searchable) return null
  return (
    <div className="mt-3">
      <SearchField
        label="Buscar por bairro ou nome"
        placeholder="Ex.: Leblon"
        value={search.query}
        onChange={search.setQuery}
        summary={search.summary}
      />
    </div>
  )
}
