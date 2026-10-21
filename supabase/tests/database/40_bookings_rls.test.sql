begin;
select plan(22);

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

insert into public.markets (id, name, capacity) values
  ('00000000-0000-0000-0000-0000000000e1', 'Mercado 1', 3),
  ('00000000-0000-0000-0000-0000000000e2', 'Mercado 2', 3);

-- Montado como dono do banco, que não passa pela RLS nem pelos privilégios dos clientes.
insert into public.bookings (id, market_id, day, supplier_id) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', current_date + 5, '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e1', current_date + 5, '00000000-0000-0000-0000-0000000000b1');

------------------------------------------------------------------ quem lê
select tests.login_as('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.bookings), 1, 'fornecedor lê só a própria reserva');
select is(
  (select supplier_id from public.bookings),
  '00000000-0000-0000-0000-0000000000a1'::uuid,
  'e é a dele, não a do outro fornecedor'
);
reset role;

select tests.login_as('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.bookings), 1, 'o outro fornecedor também lê só a própria');
reset role;

select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select is((select count(*)::int from public.bookings), 2, 'admin lê todas as reservas');
reset role;

set local role anon;
select throws_ok($$ select * from public.bookings $$, '42501', null, 'anônimo não lê reservas');
select throws_ok($$ select * from public.closed_days $$, '42501', null, 'anônimo não lê datas fechadas');
reset role;

------------------------------------------------------------------ ninguém escreve direto
select tests.login_as('00000000-0000-0000-0000-0000000000a1');
select throws_ok(
  $$ insert into public.bookings (market_id, day, supplier_id)
     values ('00000000-0000-0000-0000-0000000000e2', current_date + 7, '00000000-0000-0000-0000-0000000000a1') $$,
  '42501', null,
  'fornecedor não insere reserva direto: só pela função'
);
select throws_ok(
  $$ update public.bookings set cancelled_at = now() $$,
  '42501', null,
  'fornecedor não altera reserva direto'
);
select throws_ok($$ delete from public.bookings $$, '42501', null, 'fornecedor não apaga reserva');
reset role;

select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok(
  $$ insert into public.bookings (market_id, day, supplier_id)
     values ('00000000-0000-0000-0000-0000000000e2', current_date + 7, '00000000-0000-0000-0000-0000000000a1') $$,
  '42501', null,
  'nem o admin insere reserva direto'
);
reset role;

------------------------------------------------------------------ datas fechadas
select tests.login_as('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.closed_days), 0, 'fornecedor lê as datas fechadas (por ora nenhuma)');
select throws_ok(
  $$ insert into public.closed_days (market_id, day) values ('00000000-0000-0000-0000-0000000000e1', current_date + 9) $$,
  '42501', null,
  'fornecedor não fecha data'
);
reset role;

select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select lives_ok(
  $$ insert into public.closed_days (market_id, day, reason) values ('00000000-0000-0000-0000-0000000000e1', current_date + 9, 'Inventário') $$,
  'admin fecha uma data'
);
select throws_ok(
  $$ insert into public.closed_days (market_id, day) values ('00000000-0000-0000-0000-0000000000e1', current_date + 9) $$,
  '23505', null,
  'a mesma data não fecha duas vezes no mesmo mercado'
);
select lives_ok(
  $$ delete from public.closed_days where market_id = '00000000-0000-0000-0000-0000000000e1' and day = current_date + 9 $$,
  'admin libera a data'
);
reset role;

------------------------------------------------------------------ limite e restrições
select throws_ok(
  $$ update public.markets set capacity = 0 where id = '00000000-0000-0000-0000-0000000000e1' $$,
  '23514', null,
  'o limite não pode ser zero'
);
select throws_ok(
  $$ update public.markets set capacity = 21 where id = '00000000-0000-0000-0000-0000000000e1' $$,
  '23514', null,
  'o limite tem teto de 20'
);

select throws_ok(
  $$ insert into public.bookings (market_id, day, supplier_id)
     values ('00000000-0000-0000-0000-0000000000e1', current_date + 5, '00000000-0000-0000-0000-0000000000a1') $$,
  '23505', null,
  'um fornecedor não tem duas reservas ativas no mesmo mercado e dia'
);
select throws_ok(
  $$ update public.bookings set cancelled_at = now() where id = '00000000-0000-0000-0000-0000000000f1' $$,
  '23514', null,
  'cancelar exige dizer quem cancelou'
);

------------------------------------------------------------------ camada 2: o trigger de guarda
update public.markets set capacity = 2 where id = '00000000-0000-0000-0000-0000000000e1';
select throws_ok(
  $$ insert into public.bookings (market_id, day, supplier_id)
     values ('00000000-0000-0000-0000-0000000000e1', current_date + 5, '00000000-0000-0000-0000-0000000000c1') $$,
  '23514', 'booking_over_capacity',
  'o trigger recusa insert acima do limite, mesmo sem passar pela função'
);
insert into public.bookings (market_id, day, supplier_id)
  values ('00000000-0000-0000-0000-0000000000e1', current_date + 6, '00000000-0000-0000-0000-0000000000a1');
select pass('o limite é por dia: outro dia do mesmo mercado ainda aceita');

update public.bookings
  set cancelled_at = now(), cancelled_by = '00000000-0000-0000-0000-0000000000c1'
  where id = '00000000-0000-0000-0000-0000000000f2';
select lives_ok(
  $$ insert into public.bookings (market_id, day, supplier_id)
     values ('00000000-0000-0000-0000-0000000000e1', current_date + 5, '00000000-0000-0000-0000-0000000000c1') $$,
  'cancelar libera a vaga para uma reserva nova'
);

select * from finish();
rollback;
