# ADR 0002: O dia é o do fuso da empresa (Brasília), calculado pelo servidor

**Status:** aceito (21/10/2026)

## Contexto

O dia calculado no calendário do aparelho sai errado num celular com o fuso trocado ou de viagem, e a data que o aparelho manda não é confiável. Todos os mercados e fornecedores operam no horário de Brasília. (A decisão nasceu no produto anterior, a rota do repositor, e vale igual para as reservas.)

## Decisão

- **`COMPANY_TIME_ZONE = 'America/Sao_Paulo'`** e `companyDate(instante)` em `src/domain/dates.ts` são a única fonte do "dia" no TypeScript. O relógio do app (`systemClock`) e a formatação de horas (`formatTime`) usam o fuso da empresa.
- **`public.company_date(timestamptz)`** faz o mesmo no banco. `domain/schema-sync.test.ts` confere que o fuso é o mesmo nos dois lados, e o pgTAP testa a virada do dia (23h59 e 00h00 de Brasília) com o fuso da sessão trocado.
- **O servidor calcula o dia** ("hoje", a janela de reserva, o que já passou) com `company_date(now())`; o aparelho só desenha o calendário.

## Consequências

- Quem decide é o servidor. O relógio do aparelho só afeta o desenho do calendário, e a recusa do servidor corrige a tela.
- Brasília não tem horário de verão desde 2019, então o fuso é um deslocamento fixo de -3 h e qualquer horário agendado em UTC seria estável. Se a regra voltar, esta decisão e os horários agendados precisam ser revistos.
- Se a empresa passar a operar em mais de um fuso, o fuso vira atributo do mercado. É uma mudança grande, fora do MVP.
- Todo código de data precisa passar na matriz de fusos do CI (UTC, São Paulo, Los Angeles e Kiritimati).
