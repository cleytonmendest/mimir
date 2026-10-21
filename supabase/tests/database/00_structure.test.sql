begin;
select plan(7);

-- Guard rail estrutural: uma tabela nova sem RLS derruba o CI aqui.
select is(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  0,
  'toda tabela em public tem RLS ligado'
);

select is(
  (select count(*)::int
     from information_schema.role_table_grants
    where grantee = 'anon' and table_schema = 'public'),
  0,
  'o papel anon não tem nenhum privilégio em tabelas de public'
);

select is_empty(
  $$
    select p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and not exists (
         select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%'
       )
  $$,
  'toda função security definer fixa o search_path'
);

select is(
  (select count(*)::int
     from information_schema.role_table_grants
    where grantee = 'authenticated' and table_schema = 'public'
      and table_name = 'audit_log' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  0,
  'o log de auditoria não é gravável pela API'
);

select is(
  (select count(*)::int
     from information_schema.role_table_grants
    where grantee = 'authenticated' and table_schema = 'public'
      and table_name = 'markets' and privilege_type = 'DELETE'),
  0,
  'ninguém logado apaga mercados (arquiva)'
);

select is_empty(
  $$
    select tablename from pg_tables
     where schemaname = 'public'
       and tablename in ('visits', 'visit_events', 'standard_route', 'device_status', 'app_config')
  $$,
  'as tabelas do produto antigo (visitas, rota, eventos, aparelhos) não existem mais'
);

select is(
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
     from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'user_role'),
  array['admin', 'supplier'],
  'os papéis são admin e supplier'
);

select * from finish();
rollback;
