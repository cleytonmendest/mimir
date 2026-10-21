begin;
select plan(21);

create schema tests;

create function tests.make_user(uid uuid, mail text, as_role public.user_role default 'repositor')
returns void language plpgsql as $$
begin
  insert into auth.users (id, email) values (uid, mail);
  update public.profiles set role = as_role, full_name = mail where id = uid;
end;
$$;

create function tests.login_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;

select tests.make_user('00000000-0000-0000-0000-0000000000a1', 'ana@test.dev');
select tests.make_user('00000000-0000-0000-0000-0000000000b1', 'bruno@test.dev');
select tests.make_user('00000000-0000-0000-0000-0000000000c1', 'leader@test.dev', 'leader');

insert into public.markets (id, name) values ('00000000-0000-0000-0000-0000000000e1', 'Mercado 1');
insert into public.visits (id, repositor_id, market_id, visit_date, position) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', '2026-10-21', 0);

------------------------------------------------------------------ mudança do repositor
select tests.login_as('00000000-0000-0000-0000-0000000000a1');
select lives_ok(
  $$ update public.visits set position = 3 where id = '00000000-0000-0000-0000-0000000000f1' $$,
  'repositor reordena a própria visita'
);
reset role;

select is(
  (select count(*)::int from public.audit_log
    where table_name = 'visits' and row_id = '00000000-0000-0000-0000-0000000000f1' and action = 'update'),
  1,
  'a mudança gerou exatamente uma entrada de log'
);
select is(
  (select changes from public.audit_log where row_id = '00000000-0000-0000-0000-0000000000f1' and action = 'update' and actor_role = 'repositor'),
  '{"position": {"from": 0, "to": 3}}'::jsonb,
  'o log guarda só o campo que mudou, com antes e depois'
);
select is(
  (select old_row is null and new_row is null from public.audit_log
    where row_id = '00000000-0000-0000-0000-0000000000f1' and action = 'update' and actor_role = 'repositor'),
  true,
  'no update o log guarda só a diferença, sem repetir a linha inteira'
);
select is(
  (select source from public.audit_log
    where row_id = '00000000-0000-0000-0000-0000000000f1' and action = 'update' and actor_role = 'repositor'),
  'app',
  'escrita direta pela API é registrada como origem "app"'
);
select is(
  (select actor_id from public.audit_log where row_id = '00000000-0000-0000-0000-0000000000f1' and action = 'update' and actor_role = 'repositor'),
  '00000000-0000-0000-0000-0000000000a1'::uuid,
  'o log guarda quem mudou'
);
select is(
  (select actor_role::text from public.audit_log where action = 'update' and actor_id = '00000000-0000-0000-0000-0000000000a1'),
  'repositor',
  'o log guarda o papel de quem mudou'
);

------------------------------------------------------------------ mudança do líder
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select lives_ok(
  $$ update public.visits set note = 'x' where id = '00000000-0000-0000-0000-0000000000f1' $$,
  'líder altera a observação'
);
reset role;

select is(
  (select changes from public.audit_log where row_id = '00000000-0000-0000-0000-0000000000f1' and action = 'update' and actor_role = 'leader'),
  '{"note": {"from": null, "to": "x"}}'::jsonb,
  'mudança do líder também fica registrada, sem ruído de updated_at'
);

select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select lives_ok(
  $$ update public.visits set position = position where id = '00000000-0000-0000-0000-0000000000f1' $$,
  'atualização que não muda nada'
);
reset role;

select is(
  (select count(*)::int from public.audit_log
    where table_name = 'visits' and row_id = '00000000-0000-0000-0000-0000000000f1' and action = 'update'),
  2,
  'atualização sem mudança não gera log'
);

select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select lives_ok(
  $$ insert into public.visits (repositor_id, market_id, visit_date)
     values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', '2026-10-22') $$,
  'líder cria visita para o bruno'
);
reset role;

select is(
  (select count(*)::int from public.audit_log
    where table_name = 'visits' and action = 'insert' and actor_id = '00000000-0000-0000-0000-0000000000c1'),
  1,
  'criação feita pelo líder fica registrada'
);
select is(
  (select new_row is not null and old_row is null from public.audit_log
    where table_name = 'visits' and action = 'insert' and actor_id = '00000000-0000-0000-0000-0000000000c1'),
  true,
  'na criação o log guarda a linha inteira'
);

------------------------------------------------------------------ quem lê e quem escreve o log
select tests.login_as('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.audit_log), 0, 'repositor não lê o log de auditoria');
reset role;

select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select ok((select count(*) from public.audit_log) > 0, 'líder lê o log de auditoria');

select throws_ok(
  $$ insert into public.audit_log (table_name, row_id, action) values ('visits', gen_random_uuid(), 'update') $$,
  '42501', null,
  'nem o líder grava no log pela API'
);
select throws_ok(
  $$ update public.audit_log set actor_id = null $$,
  '42501', null,
  'ninguém reescreve o log'
);
select throws_ok(
  $$ delete from public.audit_log $$,
  '42501', null,
  'ninguém apaga o log'
);
reset role;

------------------------------------------------------------------ outras tabelas auditadas
select tests.login_as('00000000-0000-0000-0000-0000000000a1');
insert into public.standard_route (repositor_id, weekday, market_id)
  values ('00000000-0000-0000-0000-0000000000a1', 2, '00000000-0000-0000-0000-0000000000e1');
insert into public.markets (name) values ('Mercado novo');
reset role;

select is(
  (select count(*)::int from public.audit_log
    where table_name = 'standard_route' and actor_id = '00000000-0000-0000-0000-0000000000a1'),
  1,
  'mudança na rota padrão fica registrada'
);
select is(
  (select count(*)::int from public.audit_log
    where table_name = 'markets' and action = 'insert' and actor_id = '00000000-0000-0000-0000-0000000000a1'),
  1,
  'mudança em mercados fica registrada'
);

select * from finish();
rollback;
