begin;
select plan(7);

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

------------------------------------------------------------------ fornecedora
select tests.login_as('00000000-0000-0000-0000-0000000000a1');

select is((select count(*)::int from public.markets), 1, 'fornecedor lê os mercados (escolhe onde reservar)');

select throws_ok(
  $$ insert into public.markets (name) values ('Mercado do fornecedor') $$,
  '42501', null,
  'fornecedor não cadastra mercado'
);

select is_empty(
  $$ with u as (update public.markets set name = 'Trocado' where id = '00000000-0000-0000-0000-0000000000e1' returning id) select id from u $$,
  'fornecedor não edita mercado'
);

reset role;

------------------------------------------------------------------ admin
select tests.login_as('00000000-0000-0000-0000-0000000000c1');

select lives_ok(
  $$ insert into public.markets (name) values ('Mercado novo') $$,
  'admin cadastra mercado'
);

select lives_ok(
  $$ update public.markets set name = 'Mercado Central' where id = '00000000-0000-0000-0000-0000000000e1' $$,
  'admin edita mercado'
);

select lives_ok(
  $$ update public.markets set archived_at = now() where id = '00000000-0000-0000-0000-0000000000e1' $$,
  'admin arquiva mercado'
);

select throws_ok(
  $$ delete from public.markets where id = '00000000-0000-0000-0000-0000000000e1' $$,
  '42501', null,
  'nem o admin apaga mercado: arquiva'
);

select * from finish();
rollback;
