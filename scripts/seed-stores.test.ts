import { describe, expect, it } from 'vitest'
import { demoCapacity, storeName, ZONA_SUL_STORES } from './seed-stores.ts'

describe('ZONA_SUL_STORES', () => {
  it('tem as 31 lojas ativas da lista pública, sem a Loja 34 (inativa)', () => {
    expect(ZONA_SUL_STORES).toHaveLength(31)
    expect(ZONA_SUL_STORES.map((store) => store.code)).not.toContain('34')
  })

  it('tem códigos e nomes únicos, em ordem crescente de número', () => {
    const codes = ZONA_SUL_STORES.map((store) => store.code)
    expect(new Set(codes).size).toBe(codes.length)
    expect(codes).toEqual([...codes].sort((a, b) => Number(a) - Number(b)))
    const names = ZONA_SUL_STORES.map(storeName)
    expect(new Set(names).size).toBe(names.length)
  })

  it('escreve o nome como a rede: "Loja 07 - Leblon"', () => {
    const leblon = ZONA_SUL_STORES.find((store) => store.code === '07')
    expect(leblon).toBeDefined()
    expect(storeName(leblon!)).toBe('Loja 07 - Leblon')
    for (const store of ZONA_SUL_STORES) expect(storeName(store)).toMatch(/^Loja \d\d - \S/)
  })

  it('cabe nos limites do cadastro de mercado (nome de até 100 e endereço de até 200 caracteres)', () => {
    for (const store of ZONA_SUL_STORES) {
      expect(storeName(store).length).toBeLessThanOrEqual(100)
      expect(store.address.length).toBeGreaterThan(0)
      expect(store.address.length).toBeLessThanOrEqual(200)
      // Sem espaço sobrando nas pontas nem repetido: a busca e a tela dependem de texto limpo.
      expect(store.address).toBe(store.address.replace(/\s+/g, ' ').trim())
      expect(store.label).toBe(store.label.replace(/\s+/g, ' ').trim())
    }
  })

  it('traz o bairro no endereço, que é o que a busca por bairro lê', () => {
    for (const store of ZONA_SUL_STORES) expect(store.address).toMatch(/ - \S/)
  })
})

describe('demoCapacity', () => {
  it('é um limite de 2 a 5 estandes, sempre o mesmo para a mesma loja', () => {
    for (const store of ZONA_SUL_STORES) {
      const capacity = demoCapacity(store)
      expect(Number.isInteger(capacity)).toBe(true)
      expect(capacity).toBeGreaterThanOrEqual(2)
      expect(capacity).toBeLessThanOrEqual(5)
      expect(demoCapacity(store)).toBe(capacity)
    }
  })

  it('varia entre as lojas, para a lista mostrar limites diferentes', () => {
    expect(new Set(ZONA_SUL_STORES.map(demoCapacity)).size).toBeGreaterThan(1)
  })
})
