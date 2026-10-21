begin;
select plan(15);

create schema tests;

create function tests.make_user(uid uuid, mail text, as_role public.user_role default 'supplier')
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
select tests.make_user('00000000-0000-0000-0000-0000000000c1', 'admin@test.dev', 'admin');

insert into public.markets (id, name) values ('00000000-0000-0000-0000-0000000000e1', 'Mercado 1');

------------------------------------------------------------------ mudança do admin
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select lives_ok(
  $$ update public.markets set name = 'Mercado A' where id = '00000000-0000-0000-0000-0000000000e1' $$,
  'admin renomeia o mercado'
);
reset role;

select is(
  (select count(*)::int from public.audit_log
    where table_name = 'markets' and row_id = '00000000-0000-0000-0000-0000000000e1' and action = 'update'),
  1,
  'a mudança gerou exatamente uma entrada de log'
);
select is(
  (select changes from public.audit_log where row_id = '00000000-0000-0000-0000-0000000000e1' and action = 'update'),
  '{"name": {"from": "Mercado 1", "to": "Mercado A"}}'::jsonb,
  'o log guarda só o campo que mudou, com antes e depois'
);
select is(
  (select old_row is null and new_row is null from public.audit_log
    where row_id = '00000000-0000-0000-0000-0000000000e1' and action = 'update'),
  true,
  'no update o log guarda só a diferença, sem repetir a linha inteira'
);
select is(
  (select source from public.audit_log where row_id = '00000000-0000-0000-0000-0000000000e1' and action = 'update'),
  'app',
  'escrita direta pela API é registrada como origem "app"'
);
select is(
  (select actor_id from public.audit_log where row_id = '00000000-0000-0000-0000-0000000000e1' and action = 'update'),
  '00000000-0000-0000-0000-0000000000c1'::uuid,
  'o log guarda quem mudou'
);
select is(
  (select actor_role::text from public.audit_log where row_id = '00000000-0000-0000-0000-0000000000e1' and action = 'update'),
  'admin',
  'o log guarda o papel de quem mudou'
);

select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select lives_ok(
  $$ update public.markets set name = name where id = '00000000-0000-0000-0000-0000000000e1' $$,
  'atualização que não muda nada'
);
reset role;

select is(
  (select count(*)::int from public.audit_log
    where table_name = 'markets' and row_id = '00000000-0000-0000-0000-0000000000e1' and action = 'update'),
  1,
  'atualização sem mudança não gera log'
);

------------------------------------------------------------------ criação
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
insert into public.markets (name) values ('Mercado novo');
reset role;

select is(
  (select new_row is not null and old_row is null from public.audit_log
    where table_name = 'markets' and action = 'insert' and actor_id = '00000000-0000-0000-0000-0000000000c1'),
  true,
  'na criação o log guarda a linha inteira'
);

------------------------------------------------------------------ quem lê e quem escreve o log
select tests.login_as('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.audit_log), 0, 'fornecedor não lê o log de auditoria');
reset role;

select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select ok((select count(*) from public.audit_log) > 0, 'admin lê o log de auditoria');

select throws_ok(
  $$ insert into public.audit_log (table_name, row_id, action) values ('markets', gen_random_uuid(), 'update') $$,
  '42501', null,
  'nem o admin grava no log pela API'
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

select * from finish();
rollback;
