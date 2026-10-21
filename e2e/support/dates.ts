const TIME_ZONE = 'America/Sao_Paulo'

/** "AAAA-MM-DD" de hoje no fuso da empresa (o mesmo "hoje" que o servidor usa). */
export function companyToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date())
}

/** O dia `offset` dias depois de hoje (ou antes, se negativo), no fuso da empresa. */
export function companyDay(offset: number): string {
  const [year, month, day] = companyToday().split('-').map(Number) as [number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day + offset))
  return date.toISOString().slice(0, 10)
}
