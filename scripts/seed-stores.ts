/**
 * As lojas do Zona Sul para o seed de desenvolvimento: nome e endereço da lista pública "Nossas lojas"
 * do site da rede (novosite.zonasul.com.br/institutional/lojas), conferida em 23/10/2026. Só as ativas:
 * a Loja 34 (Barra da Tijuca) consta como inativa. É a lista das unidades cadastradas para compra pelo
 * site e pelo app, então pode haver loja física fora dela.
 *
 * Duas liberdades, só de apresentação: "Av. das América" virou "Av. das Américas" (erro de digitação da
 * lista), e a Loja 45 ficou em "Flamengo" (a lista a põe em "Barra da Tijuca", mas o nome e a rua são do
 * Flamengo). O limite de estandes por dia de cada loja NÃO vem da rede: é fictício (ver demoCapacity).
 */
export interface Store {
  /** O número da loja, como a rede o escreve ("01", "48"). */
  code: string
  label: string
  address: string
}

export const ZONA_SUL_STORES: readonly Store[] = [
  { code: '01', label: 'Ipanema', address: 'Rua Visconde de Pirajá 118 - Ipanema' },
  {
    code: '04',
    label: 'Rainha Elisabeth',
    address: 'Av. Rainha Elisabeth da Bélgica 325 - Copacabana',
  },
  { code: '06', label: 'Gávea', address: 'Av Rodrigo Otavio 269 - Gávea' },
  { code: '07', label: 'Leblon', address: 'Rua Dias Ferreira 290 - Leblon' },
  { code: '08', label: 'Ipanema', address: 'Rua Visconde de Pirajá 504 - Ipanema' },
  { code: '09', label: 'Ipanema', address: 'Rua Prudente de Morais 49 - Ipanema' },
  { code: '10', label: 'Recreio', address: 'Av. das Américas 16237 - Recreio dos Bandeirantes' },
  { code: '11', label: 'Leblon', address: 'Rua Carlos Góis 344 - Leblon' },
  { code: '12', label: 'Leme', address: 'Av. Atlântica 866 - Leme' },
  { code: '13', label: 'Angra dos Reis', address: 'Praia do Jardim S/N - Angra' },
  { code: '14', label: 'Leblon', address: 'Rua Bartolomeu Mitre 705 - Leblon' },
  { code: '17', label: 'Barra da Tijuca', address: 'Av. das Américas 3665 - Barra da Tijuca' },
  { code: '19', label: 'Copacabana', address: 'Av. Nossa Senhora de Copacabana 936 - Copacabana' },
  { code: '20', label: 'Botafogo', address: 'Rua Bambina 36 - Botafogo' },
  { code: '22', label: 'São Conrado', address: 'Estrada da Gávea 870 - São Conrado' },
  { code: '23', label: 'Barra da Tijuca', address: 'Rua Érico Veríssimo 565 - Barra da Tijuca' },
  { code: '25', label: 'Jardim Botânico', address: 'Rua Pacheco Leão 16 - Jardim Botânico' },
  { code: '28', label: 'Urca', address: 'Rua Marechal Cantuaria 178 - Urca' },
  { code: '32', label: 'Laranjeiras', address: 'Rua das Laranjeiras 215 - Laranjeiras' },
  { code: '33', label: 'Humaitá', address: 'Rua Humaitá 110 - Humaitá' },
  { code: '35', label: 'Barra da Tijuca', address: 'Avenida Lucio Costa 4700 - Barra da Tijuca' },
  { code: '36', label: 'Arnaldo Quintela', address: 'Rua Arnaldo Quintela 70 - Botafogo' },
  { code: '37', label: 'Botafogo', address: 'Rua São João Batista 27 - Botafogo' },
  { code: '38', label: 'Dias da Rocha', address: 'R. Dias da Rocha 29 - Copacabana' },
  { code: '42', label: 'Botafogo', address: 'Rua São Clemente 114 - Botafogo' },
  { code: '43', label: 'Península', address: 'Av Flamboyants da Península 855 - Barra da Tijuca' },
  { code: '44', label: 'Olegário', address: 'Av. Olegário Maciel 293 - Barra da Tijuca' },
  { code: '45', label: 'Flamengo', address: 'Rua Machado de Assis 40 - Flamengo' },
  { code: '46', label: 'Botafogo', address: 'Rua Voluntários da Pátria 190 - Botafogo' },
  { code: '47', label: 'Catete', address: 'Rua do Catete 194 - Catete' },
  {
    code: '48',
    label: 'Recreio',
    address: 'Avenida das Américas 18001 - Recreio dos Bandeirantes',
  },
]

/** "Loja 07 - Leblon": o nome que a rede usa. */
export function storeName(store: Store): string {
  return `Loja ${store.code} - ${store.label}`
}

/** Limite fictício de 2 a 5, sempre o mesmo para a mesma loja (o seed tem de dar o mesmo resultado a cada rodada). */
export function demoCapacity(store: Store): number {
  return 2 + (Number(store.code) % 4)
}
