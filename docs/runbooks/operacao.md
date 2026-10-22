# Runbook: operação do dia a dia e quando algo dá errado

Complementa o [runbook de acesso](acesso.md). Para quem opera o projeto. O dono dos mercados não precisa de nada daqui.

## "Reserva indevida" (fornecedor abusando das vagas)

1. Administração → Agenda → escolha o mercado e o dia → **Cancelar** a reserva, com o motivo (fica na auditoria).
2. Se for recorrente: Fornecedores → **Desativar** (cancela as reservas futuras da pessoa e corta o acesso).
3. O sistema **não avisa** o fornecedor: combine com ele por fora.
4. Para ver tudo o que a pessoa fez: `audit_log` filtrando `actor_id` (só o administrador lê; pelo painel do Supabase com a chave de serviço).

## Mercado fechado de última hora

Administração → Agenda → escolha o dia → **Fechar o dia**. Isso **só impede reservas novas**: as que já existem continuam valendo. Cancele-as uma a uma (com motivo) e avise os fornecedores por fora. Para a decisão de um dia inteiro, vale combinar antes com os fornecedores.

## Limite de estandes ultrapassado?

Não deveria acontecer: a trava no banco, o gatilho de guarda e o teste de concorrência garantem. Se alguém desconfiar, esta consulta lista dias acima do limite **atual** do mercado:

```sql
select b.market_id, m.name, b.day, count(*) as reservas, m.capacity
  from public.bookings b join public.markets m on m.id = b.market_id
 where b.cancelled_at is null
 group by b.market_id, m.name, b.day, m.capacity
having count(*) > m.capacity;
```

Atenção: **reduzir o limite de um mercado não cancela reservas existentes** (decisão do ADR 0005). Um dia que apareça aqui logo depois de o dono reduzir o limite é esperado; para saber o limite de quando a reserva foi feita, veja `audit_log` da tabela `markets`.

## Backup e restore

- **Produção (Supabase Pro):** backups diários e recuperação em ponto no tempo (PITR) ligados no painel. Anote onde isso está configurado e quem tem acesso.
- **Restore:** restaurar no painel para um novo projeto, conferir (login, uma agenda, contagem de reservas) e só então trocar as variáveis do app. Nunca restaurar por cima do projeto em uso sem ter copiado o estado atual.
- **Teste de restore:** a cada trimestre, restaurar o backup mais recente num projeto descartável e rodar `npm run db:test` nele. Backup que nunca foi restaurado não é backup.
- **Migrations** são a fonte do schema: um banco novo se monta aplicando `supabase/migrations/` na ordem.

## Troca de chaves

Se a chave de serviço (ou o segredo JWT) vazar:

1. No painel do Supabase, gire as chaves (API → JWT e chaves). Isso invalida as sessões e as chaves antigas.
2. Atualize `VITE_SUPABASE_ANON_KEY` no build/hospedagem do app e publique de novo.
3. As Edge Functions recebem as novas chaves sozinhas ao reimplantar (`supabase functions deploy`).
4. Reemita o link do primeiro administrador se precisar (`scripts/bootstrap-admin.ts`).
5. Rode a varredura de segredos (o CI já roda o gitleaks) para garantir que a chave velha não está no repositório.

A chave de serviço **nunca** vai para `src/` nem para variável `VITE_*` (o guard `no-service-role` derruba o CI).

## Edge Function falhando

Painel do Supabase → Edge Functions → Logs da função (`admin-create-supplier`, `admin-supplier-link`, `signup-status`, `public-signup`). Erros esperados: 401 (sem login), 403 (não é administrador), 409 (e-mail repetido), 429 (muitas tentativas). 502 "UPSTREAM" é o Auth fora do ar: nada fica criado pela metade (a função desfaz).

## Desempenho

Medido com carga sintética (`supabase/perf/load-check.sql`: 50 mercados, 60 dias, 500 fornecedores, ~6.700 reservas, tudo desfeito no fim). Meta: menos de 50 ms por consulta.

| Consulta                                              | Tempo medido |
| ----------------------------------------------------- | ------------ |
| Disponibilidade de um mercado, 60 dias (calendário)   | ~2 ms        |
| Minhas reservas (fornecedor)                          | ~1 ms        |
| Reservar um dia (função inteira, com trava e gatilho) | ~1 ms        |
| Agenda do administrador, um mercado, com nomes        | ~0,5 ms      |
| Agenda do administrador, todos os mercados, com nomes | ~8 ms        |

Para repetir: `docker exec -i supabase_db_<project_id> psql -U postgres -v ON_ERROR_STOP=1 < supabase/perf/load-check.sql`.

**Limite de 1.000 linhas:** o servidor (PostgREST, `max_rows = 1000`) corta qualquer resposta de lista em 1.000 linhas, sem erro. As telas do administrador já pedem só o necessário (as 8 próximas reservas, as de um mercado e dia). A **lista de fornecedores** não tem paginação: passando de uns 900 fornecedores, ela precisa de paginação ou busca antes de o limite cortar nomes.
