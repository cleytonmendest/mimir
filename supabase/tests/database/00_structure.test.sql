begin;
select plan(8);

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
      and table_name = 'visits' and privilege_type = 'DELETE'),
  0,
  'ninguém logado apaga visitas (histórico não se apaga)'
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
      and table_name = 'visit_events' and privilege_type in ('UPDATE', 'DELETE')),
  0,
  'eventos de visita são imutáveis depois de gravados'
);

select is(
  (select count(*)::int
     from information_schema.role_table_grants
    where grantee = 'authenticated' and table_schema = 'public'
      and table_name = 'visit_events' and privilege_type = 'INSERT'),
  0,
  'eventos de visita só entram pela função de sincronização, nunca direto'
);

select is(
  (select count(*)::int
     from information_schema.role_routine_grants
    where grantee in ('authenticated', 'anon') and routine_schema = 'public'
      and routine_name in ('apply_visit_event', 'safe_uuid', 'safe_int', 'safe_timestamptz', 'version_parts', 'sync_result')),
  0,
  'as funções internas da sincronização não são chamáveis pela API'
);

select * from finish();
rollback;
