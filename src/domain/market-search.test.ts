import { describe, expect, it } from 'vitest'
import { filterMarkets, matchesSearch, normalizeSearch, searchSummary } from './market-search'

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
