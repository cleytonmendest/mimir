import { describe, expect, it } from 'vitest'
import {
  filterMarkets,
  groupByNeighborhood,
  GROUP_MIN_MARKETS,
  matchesSearch,
  neighborhood,
  normalizeSearch,
  searchSummary,
  shouldGroup,
} from './market-search'

const leblon = { name: 'Loja 07 - Leblon', address: 'Rua Dias Ferreira 290 - Leblon' }
const gavea = { name: 'Loja 06 - Gávea', address: 'Av Rodrigo Otavio 269 - Gávea' }
const sconrado = { name: 'Loja 22 - São Conrado', address: 'Estrada da Gávea 870 - São Conrado' }
const semEndereco = { name: 'Mercado Novo', address: null }
const todos = [leblon, gavea, sconrado, semEndereco]

describe('normalizeSearch', () => {
  it('tira acento, caixa e espaço sobrando', () => {
    expect(normalizeSearch('  GÁVEA   Ção\tÜ  ')).toBe('gavea cao u')
    expect(normalizeSearch('São Conrado')).toBe('sao conrado')
  })

  it('o vazio continua vazio', () => {
    expect(normalizeSearch('')).toBe('')
    expect(normalizeSearch('   ')).toBe('')
  })
})

describe('matchesSearch', () => {
  it('sem busca, tudo casa', () => {
    expect(matchesSearch('', leblon)).toBe(true)
    expect(matchesSearch('   ', semEndereco)).toBe(true)
  })

  it('não liga para acento nem para maiúscula', () => {
    expect(matchesSearch('gavea', gavea)).toBe(true)
    expect(matchesSearch('GÁVEA', gavea)).toBe(true)
    expect(matchesSearch('sao conrado', sconrado)).toBe(true)
  })

  it('casa pedaço de palavra, para a busca valer enquanto se digita', () => {
    expect(matchesSearch('leb', leblon)).toBe(true)
    expect(matchesSearch('lebl', gavea)).toBe(false)
  })

  it('procura no nome e no endereço', () => {
    expect(matchesSearch('dias ferreira', leblon)).toBe(true)
    // "Gávea" está no nome da loja 06 e só no endereço da loja 22.
    expect(matchesSearch('gavea', sconrado)).toBe(true)
  })

  it('exige todas as palavras, em qualquer ordem', () => {
    expect(matchesSearch('leblon 07', leblon)).toBe(true)
    expect(matchesSearch('07 leblon', leblon)).toBe(true)
    expect(matchesSearch('leblon 06', leblon)).toBe(false)
  })

  it('mercado sem endereço só casa pelo nome', () => {
    expect(matchesSearch('novo', semEndereco)).toBe(true)
    expect(matchesSearch('null', semEndereco)).toBe(false)
    expect(matchesSearch('rua', semEndereco)).toBe(false)
  })
})

describe('filterMarkets', () => {
  it('mantém a ordem e devolve os mesmos objetos', () => {
    const result = filterMarkets(todos, 'gavea')
    expect(result).toEqual([gavea, sconrado])
    expect(result[0]).toBe(gavea)
  })

  it('busca vazia devolve todos; sem resultado, nenhum', () => {
    expect(filterMarkets(todos, '')).toEqual(todos)
    expect(filterMarkets(todos, 'zzz')).toEqual([])
  })

  it('não altera a lista que recebeu', () => {
    const copy = [...todos]
    filterMarkets(todos, 'leblon')
    expect(todos).toEqual(copy)
  })
})

describe('searchSummary', () => {
  it('sem busca não diz nada', () => {
    expect(searchSummary('', 4, 4)).toBeNull()
    expect(searchSummary('   ', 4, 4)).toBeNull()
  })

  it('diz quantos mercados sobraram, ou que não achou nenhum', () => {
    expect(searchSummary('gavea', 2, 31)).toBe('2 de 31 mercados')
    expect(searchSummary('gavea', 31, 31)).toBe('31 de 31 mercados')
    expect(searchSummary('zzz', 0, 31)).toBe('Nenhum mercado encontrado.')
  })
})

describe('neighborhood', () => {
  it('é o que vem depois do último " - " do endereço', () => {
    expect(neighborhood(leblon)).toBe('Leblon')
    expect(
      neighborhood({ name: 'Loja 10', address: 'Av. das Américas 16237 - Recreio - Barra' }),
    ).toBe('Barra')
  })

  it('sem bairro no endereço, usa o do nome', () => {
    expect(neighborhood({ name: 'Loja 06 - Gávea', address: null })).toBe('Gávea')
    expect(neighborhood({ name: 'Loja 06 - Gávea', address: 'Av Rodrigo Otavio 269' })).toBe(
      'Gávea',
    )
  })

  it('um traço vazio no fim não conta como bairro', () => {
    expect(neighborhood({ name: 'Loja 06 - Gávea', address: 'Av Rodrigo Otavio 269 - ' })).toBe(
      'Gávea',
    )
  })

  it('sem nenhum dos dois, não há bairro', () => {
    expect(neighborhood(semEndereco)).toBeNull()
    expect(neighborhood({ name: 'Mercado', address: 'Rua sem bairro 10' })).toBeNull()
  })
})

describe('groupByNeighborhood', () => {
  const ipanema1 = { name: 'Loja 01', address: 'Rua A 1 - Ipanema' }
  const ipanema2 = { name: 'Loja 08', address: 'Rua B 2 - Ipanema' }
  const ipanemaSemAcento = { name: 'Loja 09', address: 'Rua C 3 - IPANEMA' }
  const abc = { name: 'Loja 05', address: 'Rua D 4 - Ábaco' }

  it('agrupa em ordem alfabética, sem ligar para acento nem caixa, e deixa os sem bairro por último', () => {
    const groups = groupByNeighborhood([
      semEndereco,
      ipanema1,
      leblon,
      abc,
      ipanema2,
      ipanemaSemAcento,
    ])
    expect(groups.map((group) => group.name)).toEqual(['Ábaco', 'Ipanema', 'Leblon', null])
  })

  it('mantém a ordem de chegada dentro do bairro e a grafia do primeiro', () => {
    const groups = groupByNeighborhood([ipanema2, ipanema1, ipanemaSemAcento])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.name).toBe('Ipanema')
    expect(groups[0]?.markets).toEqual([ipanema2, ipanema1, ipanemaSemAcento])
  })

  it('vários mercados sem bairro formam um grupo só', () => {
    const outro = { name: 'Mercado Velho', address: null }
    const groups = groupByNeighborhood([semEndereco, outro])
    expect(groups).toEqual([{ name: null, markets: [semEndereco, outro] }])
  })

  it('sem mercados, sem grupos', () => {
    expect(groupByNeighborhood([])).toEqual([])
  })
})

describe('shouldGroup', () => {
  const make = (count: number, bairros: number) =>
    Array.from({ length: count }, (_, index) => ({
      name: `Loja ${index}`,
      address: `Rua ${index} - Bairro ${index % bairros}`,
    }))

  it('só com muitos mercados e mais de um bairro', () => {
    expect(shouldGroup(make(GROUP_MIN_MARKETS, 3))).toBe(true)
    expect(shouldGroup(make(GROUP_MIN_MARKETS - 1, 3))).toBe(false)
    expect(shouldGroup(make(30, 1))).toBe(false)
  })

  it('mercados sem bairro não contam como um bairro', () => {
    const semBairro = Array.from({ length: 10 }, (_, index) => ({
      name: `Mercado ${index}`,
      address: null,
    }))
    expect(shouldGroup([...semBairro, leblon])).toBe(false)
    expect(shouldGroup([...semBairro, leblon, gavea])).toBe(true)
  })
})
