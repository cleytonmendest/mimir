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

/** A partir de quantos mercados a lista ganha títulos por bairro (abaixo disso, uma lista só basta). */
export const GROUP_MIN_MARKETS = 9

/**
 * O bairro do mercado: o que vem depois do último " - " do endereço ("Rua Dias Ferreira 290 -
 * Leblon") ou, sem endereço, do nome ("Loja 07 - Leblon"). Sem nenhum dos dois, null.
 */
export function neighborhood(market: Searchable): string | null {
  for (const text of [market.address, market.name]) {
    if (text === null) continue
    const dash = text.lastIndexOf(' - ')
    if (dash === -1) continue
    const name = text.slice(dash + 3).trim()
    if (name !== '') return name
  }
  return null
}

export interface NeighborhoodGroup<T> {
  /** O bairro, ou null para os mercados sem bairro conhecido. */
  name: string | null
  markets: T[]
}

/**
 * Os mercados agrupados por bairro, em ordem alfabética (os sem bairro por último). Dentro de cada
 * bairro, a ordem em que vieram. "Gávea" e "gavea" são o mesmo bairro; vale a grafia do primeiro.
 */
export function groupByNeighborhood<T extends Searchable>(
  markets: readonly T[],
): NeighborhoodGroup<T>[] {
  const named = new Map<string, { name: string; markets: T[] }>()
  const unnamed: T[] = []
  for (const market of markets) {
    const name = neighborhood(market)
    if (name === null) {
      unnamed.push(market)
      continue
    }
    const key = normalizeSearch(name)
    const group = named.get(key) ?? { name, markets: [] }
    group.markets.push(market)
    named.set(key, group)
  }
  const groups: NeighborhoodGroup<T>[] = [...named.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'pt-BR'),
  )
  if (unnamed.length > 0) groups.push({ name: null, markets: unnamed })
  return groups
}

/** Vale agrupar? Só com muitos mercados e mais de um bairro: um título sozinho não ajuda ninguém. */
export function shouldGroup(markets: readonly Searchable[]): boolean {
  if (markets.length < GROUP_MIN_MARKETS) return false
  return groupByNeighborhood(markets).filter((group) => group.name !== null).length >= 2
}

/**
 * A frase que diz quantos mercados a busca deixou, para leitor de tela e para quem olha. Sem busca
 * não há o que dizer (null).
 */
export function searchSummary(query: string, shown: number, total: number): string | null {
  if (normalizeSearch(query) === '') return null
  return shown === 0 ? 'Nenhum mercado encontrado.' : `${shown} de ${total} mercados`
}
