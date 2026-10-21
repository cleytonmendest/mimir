# ADR 0003: Fim do dia automático só marca "não foi"; evento atrasado vai para o líder

**Status:** aceito (21/10/2026). A tolerância para sincronização atrasada será reavaliada com os dados do teste de campo.

## Contexto

Visita que ninguém registrou fica "planejada" ou "em andamento" para sempre. Ao mesmo tempo, um aparelho que passou o dia sem sinal pode sincronizar só no dia seguinte, depois de o dia ter sido fechado.

## Decisão

- **Um job diário fecha os dias passados**: visita `planned` ou `in_progress` de dia anterior vira `not_done` ("Sem registro" ou "Sem check-out", como `closeDay` no domínio). Roda às **06:00 UTC (03:00 de Brasília)**, é idempotente e recupera sozinho se uma noite falhar. O ator no log de auditoria é "Sistema".
- **Não passa sobras sozinho.** O líder decide o que remanejar (`carryOver`, `addVisit`, `moveVisitToDate`).
- **Evento que chega depois do fechamento é recusado** com o status e o motivo atuais, e cai numa **caixa do líder** com "aplicar" (individual ou em lote) e "descartar". Não existe "evento atrasado vence o fechamento automático".
- **O mesmo job cria as visitas dos próximos 14 dias** a partir da rota padrão, ignorando mercado arquivado.

### Por que não "evento tardio vence" com 1 dia de tolerância

Foi considerado e deixado de lado: exige registrar quem fechou, um caso a mais na função do servidor, uma exceção no trigger de guarda (o repositor hoje não pode ir de `not_done` para `done`) e conflita com as cópias que o líder já criou. Pior: com o dia aberto até D+2, o líder **não consegue** remanejar na manhã de D+1, porque `plan.ts` não deixa mexer em visita `planned` de dia passado.

## O que verificamos (spike S3, Postgres 17 do Supabase local)

- `pg_cron` 1.6.4 está disponível e pré-carregado; criar a extensão e agendar um job funcionam numa migration.
- `cron.timezone = GMT`: o agendamento é em **UTC** (por isso 06:00 UTC).
- O papel `authenticated` **não** tem acesso ao schema `cron`: clientes não conseguem agendar nada.
- Ainda a confirmar no projeto Supabase **hospedado** (homologação, fatia 0.4). Se não funcionar lá, a alternativa é uma Edge Function agendada ou um cron do GitHub Actions chamando a função.

## Consequências

- Um repositor que fique offline de uma madrugada à outra terá eventos recusados e dependerá do líder para aplicá-los. Reavaliar a tolerância depois do protocolo de campo ("2 dias sem rede").
- A caixa de recusados do líder e a explicação ao repositor fazem parte do MVP.
