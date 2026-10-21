begin;
select plan(10);

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
select tests.make_user('00000000-0000-0000-0000-0000000000b1', 'bruno@test.dev');
select tests.make_user('00000000-0000-0000-0000-0000000000c1', 'admin@test.dev', 'admin');

------------------------------------------------------------------ como fornecedora
select tests.login_as('00000000-0000-0000-0000-0000000000a1');

select is_empty(
  $$ with u as (update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000a1' returning id) select id from u $$,
  'fornecedor não consegue se promover a admin'
);

select is((select count(*)::int from public.profiles), 1, 'fornecedor só enxerga o próprio perfil');

reset role;

select is(
  (select role::text from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'),
  'supplier',
  'o papel da ana continua supplier'
);

------------------------------------------------------------------ como admin
select tests.login_as('00000000-0000-0000-0000-0000000000c1');

select is((select count(*)::int from public.profiles), 3, 'admin enxerga todos os perfis');

select lives_ok(
  $$ update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000b1' $$,
  'admin altera o papel de outro usuário'
);

------------------------------------------------------------------ conta nova e anônimo
reset role;

select tests.make_user('00000000-0000-0000-0000-0000000000d1', 'novo@test.dev');
select is(
  (select role::text from public.profiles where id = '00000000-0000-0000-0000-0000000000d1'),
  'supplier',
  'conta nova nasce com o menor privilégio (supplier)'
);

insert into auth.users (id, email, raw_user_meta_data)
  values ('00000000-0000-0000-0000-0000000000d2', 'esperto@test.dev', '{"role": "admin"}'::jsonb);
select is(
  (select role::text from public.profiles where id = '00000000-0000-0000-0000-0000000000d2'),
  'supplier',
  'o papel nunca vem dos metadados do cadastro: quem pede admin continua supplier'
);

set local role anon;

select throws_ok($$ select * from public.profiles $$, '42501', null, 'anônimo não lê perfis');
select throws_ok($$ select * from public.audit_log $$, '42501', null, 'anônimo não lê o log de auditoria');
select throws_ok($$ select * from public.markets $$, '42501', null, 'anônimo não lê mercados');

select * from finish();
rollback;
