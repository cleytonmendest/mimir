# ADR 0002: O dia é o do fuso da empresa (Brasília), calculado pelo servidor

**Status:** aceito (21/10/2026)

## Contexto

A tela "Hoje" lia o dia no calendário do aparelho. Um celular com o fuso trocado, ou de viagem, passava a ver as visitas do dia errado, e a data enviada em um evento offline vinha do próprio aparelho. Todos os repositores trabalham no horário de Brasília.

## Decisão

- **`COMPANY_TIME_ZONE = 'America/Sao_Paulo'`** e `companyDate(instante)` em `src/domain/dates.ts` são a única fonte do "dia" no TypeScript. O relógio do app (`systemClock`) e a formatação de horas (`formatTime`) usam o fuso da empresa.
- **`public.company_date(timestamptz)`** faz o mesmo no banco. `domain/schema-sync.test.ts` confere que o fuso é o mesmo nos dois lados, e o pgTAP testa a virada do dia (23h59 e 00h00 de Brasília) com o fuso da sessão trocado.
- **O servidor calcula o dia** de cada evento a partir do instante; a data que o aparelho mandar serve só de diagnóstico.

## Consequências

- Só o **relógio** do aparelho conta, não o fuso. Relógio errado continua sendo risco: o plano trata com a diferença para o relógio do servidor e um aviso (ver `docs/mvp.md`, marco 1).
- Brasília não tem horário de verão desde 2019, então o fuso é um deslocamento fixo de -3 h e agendamentos em UTC (ADR 0003) são estáveis. Se a regra voltar, esta decisão e os horários agendados precisam ser revistos.
- Se a empresa passar a operar em mais de um fuso, o fuso vira atributo do repositor ou do mercado, e o fechamento do dia roda por fuso. É uma mudança grande, fora do MVP.
- Todo código de data precisa passar na matriz de fusos do CI (UTC, São Paulo, Los Angeles e Kiritimati).
