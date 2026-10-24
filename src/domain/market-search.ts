/**
 * Busca de mercados por nome e endereço (o endereço traz o bairro). Quem procura digita "gavea" para
 * achar "Loja 06 - Gávea": caixa e acento não contam, e todas as palavras digitadas têm de aparecer
 * (em qualquer ordem), então "leblon 07" acha só a Loja 07 do Leblon.
 */

export interface Searchable {
  name: string
  address: string | null
}

/** Minúsculas, sem acento e com espaços simples: "  Gávea " e "gavea" viram a mesma coisa. */
export function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

export function matchesSearch(query: string, market: Searchable): boolean {
  const words = normalizeSearch(query).split(' ').filter(Boolean)
  if (words.length === 0) return true
  const haystack = normalizeSearch(`${market.name} ${market.address ?? ''}`)
  return words.every((word) => haystack.includes(word))
}

/** Os mercados que casam com a busca, na ordem em que vieram. Busca vazia devolve todos. */
export function filterMarkets<T extends Searchable>(markets: readonly T[], query: string): T[] {
  return markets.filter((market) => matchesSearch(query, market))
}

/**
 * A frase que diz quantos mercados a busca deixou, para leitor de tela e para quem olha. Sem busca
 * não há o que dizer (null).
 */
export function searchSummary(query: string, shown: number, total: number): string | null {
  if (normalizeSearch(query) === '') return null
  return shown === 0 ? 'Nenhum mercado encontrado.' : `${shown} de ${total} mercados`
}
