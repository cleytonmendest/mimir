import { useState } from 'react'
import { filterMarkets, searchSummary, type Searchable } from '@/domain/market-search'

export interface MarketSearch {
  query: string
  setQuery: (query: string) => void
  /** A frase do resultado ("3 de 31 mercados"), ou null enquanto não há busca. */
  summary: string | null
  /** Com um mercado só não há o que buscar: o campo nem aparece. */
  searchable: boolean
}

/** A busca de uma lista de mercados: o que foi digitado, os mercados que casam e a frase do resultado. */
export function useMarketSearch<T extends Searchable>(
  markets: readonly T[],
): MarketSearch & { shown: T[] } {
  const [query, setQuery] = useState('')
  const shown = filterMarkets(markets, query)
  return {
    query,
    setQuery,
    shown,
    summary: searchSummary(query, shown.length, markets.length),
    searchable: markets.length > 1,
  }
}
