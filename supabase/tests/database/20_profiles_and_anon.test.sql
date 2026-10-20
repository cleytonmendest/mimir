begin;
select plan(9);

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

------------------------------------------------------------------ como ana
select tests.login_as('00000000-0000-0000-0000-0000000000a1');

select is_empty(
  $$ with u as (update public.profiles set role = 'leader' where id = '00000000-0000-0000-0000-0000000000a1' returning id) select id from u $$,
  'repositor não consegue se promover a líder'
);

select is((select count(*)::int from public.profiles), 1, 'repositor só enxerga o próprio perfil');

reset role;

select is(
  (select role::text from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'),
  'repositor',
  'o papel da ana continua repositor'
);

------------------------------------------------------------------ como líder
select tests.login_as('00000000-0000-0000-0000-0000000000c1');

select is((select count(*)::int from public.profiles), 3, 'líder enxerga todos os perfis');

select lives_ok(
  $$ update public.profiles set role = 'leader' where id = '00000000-0000-0000-0000-0000000000b1' $$,
  'líder altera o papel de outro usuário'
);

------------------------------------------------------------------ usuário novo e anônimo
reset role;

select tests.make_user('00000000-0000-0000-0000-0000000000d1', 'novo@test.dev');
select is(
  (select role::text from public.profiles where id = '00000000-0000-0000-0000-0000000000d1'),
  'repositor',
  'usuário novo nasce com o menor privilégio (repositor)'
);

set local role anon;

select throws_ok($$ select * from public.visits $$, '42501', null, 'anônimo não lê visitas');
select throws_ok($$ select * from public.profiles $$, '42501', null, 'anônimo não lê perfis');
select throws_ok($$ select * from public.audit_log $$, '42501', null, 'anônimo não lê o log de auditoria');

select * from finish();
rollback;
