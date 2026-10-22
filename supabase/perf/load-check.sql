-- Carga sintética para medir as consultas quentes (disponibilidade, agenda do administrador e
-- "minhas reservas") com o volume do plano: 50 mercados, 60 dias, 500 fornecedores e dias quase
-- lotados. Tudo acontece numa transação que NO FIM É DESFEITA: não deixa dado no banco.
--
--   docker exec -i supabase_db_<project_id> psql -U postgres -v ON_ERROR_STOP=1 < supabase/perf/load-check.sql
--
-- Meta (docs/mvp.md, 6.4): cada consulta abaixo em menos de 50 ms.
begin;

-- 500 fornecedores (o gatilho cria o perfil de cada um) e 1 administrador.
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'forn' || i || '@carga.test'
from generate_series(1, 500) i;
insert into auth.users (id, email) values ('00000000-0000-4000-9000-000000000001', 'admin@carga.test');
update public.profiles set role = 'admin' where id = '00000000-0000-4000-9000-000000000001';

-- 50 mercados com 3 estandes por dia.
insert into public.markets (id, name, capacity)
select ('00000000-0000-4000-a000-' || lpad(i::text, 12, '0'))::uuid, 'Mercado ' || i, 3
from generate_series(1, 50) i;

-- Reservas: de amanhã a 60 dias à frente, cada mercado e dia com 0 a 3 reservas (média alta).
insert into public.bookings (market_id, day, supplier_id)
select m.id, public.company_date(now()) + d, p.id
from (select id, row_number() over (order by id) as mi from public.markets where name like 'Mercado %') m
cross join generate_series(1, 60) d
cross join generate_series(1, 3) k
join public.profiles p on p.role = 'supplier' and p.email = 'forn' || (((m.mi * 7 + d * 13 + k * 101) % 500) + 1) || '@carga.test'
where (m.mi + d + k) % 4 <> 0;

-- Alguns dias fechados.
insert into public.closed_days (market_id, day)
select id, public.company_date(now()) + 15 from public.markets where name like 'Mercado %' and random() < 0.2;

analyze public.bookings;
analyze public.markets;
analyze public.profiles;

select count(*) as reservas from public.bookings where cancelled_at is null;

-- Como um fornecedor logado (o RLS e as funções rodam de verdade).
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000042', 'role', 'authenticated')::text, true);
set local role authenticated;

\echo
\echo '== Disponibilidade de um mercado, 60 dias (o calendário do fornecedor) =='
explain (analyze, buffers, timing on)
select public.market_availability_v1(
  '00000000-0000-4000-a000-000000000007', public.company_date(now()) + 1, public.company_date(now()) + 60);

\echo
\echo '== Minhas reservas (fornecedor) =='
explain (analyze, buffers, timing on)
select b.id, b.market_id, b.day, m.name
from public.bookings b left join public.markets m on m.id = b.market_id
where b.cancelled_at is null and b.day >= public.company_date(now())
order by b.day;

\echo
\echo '== Reservar um dia (a função inteira, com trava e gatilho) =='
explain (analyze, buffers, timing on)
select public.book_slot_v1('00000000-0000-4000-a000-000000000001', public.company_date(now()) + 4);

reset role;

-- Como o administrador: a agenda com nomes, de um mercado e de todos.
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-9000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

\echo
\echo '== Agenda do administrador: um mercado, 60 dias, com nomes =='
explain (analyze, buffers, timing on)
select b.id, b.market_id, b.day, b.supplier_id, m.name, p.full_name
from public.bookings b
left join public.markets m on m.id = b.market_id
left join public.profiles p on p.id = b.supplier_id
where b.cancelled_at is null and b.day >= public.company_date(now())
  and b.market_id = '00000000-0000-4000-a000-000000000007'
order by b.day, b.created_at;

\echo
\echo '== Agenda do administrador: todos os mercados, com nomes (a "próximas reservas") =='
explain (analyze, buffers, timing on)
select b.id, b.market_id, b.day, b.supplier_id, m.name, p.full_name
from public.bookings b
left join public.markets m on m.id = b.market_id
left join public.profiles p on p.id = b.supplier_id
where b.cancelled_at is null and b.day >= public.company_date(now())
order by b.day, b.created_at;

reset role;
rollback;
