begin;
select plan(44);

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

-- O "hoje" do servidor, o mesmo que as funções usam.
create function tests.today() returns date language sql as $$ select public.company_date(now()) $$;

create function tests.book(uid uuid, market uuid, d date) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform tests.login_as(uid);
  r := public.book_slot_v1(market, d);
  reset role;
  return r;
end;
$$;

create function tests.cancel(uid uuid, booking uuid, reason text default null) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform tests.login_as(uid);
  r := public.cancel_booking_v1(booking, reason);
  reset role;
  return r;
end;
$$;

create function tests.avail(uid uuid, market uuid, d_from date, d_to date) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform tests.login_as(uid);
  r := public.market_availability_v1(market, d_from, d_to);
  reset role;
  return r;
end;
$$;

select tests.make_user('00000000-0000-0000-0000-0000000000a1', 'ana@test.dev');
select tests.make_user('00000000-0000-0000-0000-0000000000b1', 'bruno@test.dev');
select tests.make_user('00000000-0000-0000-0000-0000000000a2', 'caio@test.dev');
select tests.make_user('00000000-0000-0000-0000-0000000000a3', 'dora@test.dev');
select tests.make_user('00000000-0000-0000-0000-0000000000c1', 'admin@test.dev', 'admin');

insert into public.markets (id, name, capacity, archived_at) values
  ('00000000-0000-0000-0000-0000000000e1', 'Mercado 1', 3, null),
  ('00000000-0000-0000-0000-0000000000e2', 'Mercado 2', 2, null),
  ('00000000-0000-0000-0000-0000000000e3', 'Mercado arquivado', 3, now()),
  ('00000000-0000-0000-0000-0000000000e4', 'Mercado do calendário', 3, null);

------------------------------------------------------------------ reservar
select ok(
  tests.book('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', tests.today() + 10)
    @> '{"ok": true, "already_booked": false, "booked": 1, "capacity": 3}'::jsonb,
  'a ana reserva um dia livre'
);
select is(
  (select count(*)::int from public.bookings
    where supplier_id = '00000000-0000-0000-0000-0000000000a1' and cancelled_at is null),
  1,
  'a reserva ficou gravada, ativa'
);
select is(
  tests.book('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', tests.today() + 10) ->> 'booking_id',
  (select id::text from public.bookings where supplier_id = '00000000-0000-0000-0000-0000000000a1'),
  'repetir a reserva devolve a mesma, sem criar outra (clique duplo, falha de rede)'
);
select is(
  (select count(*)::int from public.bookings where supplier_id = '00000000-0000-0000-0000-0000000000a1'),
  1,
  'e continua uma só reserva'
);
select ok(
  tests.book('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', tests.today() + 10)
    @> '{"ok": true, "booked": 2}'::jsonb,
  'o bruno reserva o mesmo dia: 2 de 3'
);
select ok(
  tests.book('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e1', tests.today() + 10)
    @> '{"ok": true, "booked": 3}'::jsonb,
  'o caio reserva a última vaga: 3 de 3'
);
select is(
  tests.book('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000e1', tests.today() + 10),
  '{"ok": false, "code": "FULL"}'::jsonb,
  'a dora chega depois: FULL, e nada é gravado'
);
select is(
  (select count(*)::int from public.bookings
    where market_id = '00000000-0000-0000-0000-0000000000e1' and day = tests.today() + 10 and cancelled_at is null),
  3,
  'o dia continua com 3 reservas, nunca 4'
);
select is(
  tests.book('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e2', tests.today() + 3) ->> 'code',
  'FORBIDDEN',
  'o administrador não reserva estande'
);

insert into public.closed_days (market_id, day) values ('00000000-0000-0000-0000-0000000000e1', tests.today() + 11);
select is(
  tests.book('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', tests.today() + 11) ->> 'code',
  'CLOSED',
  'dia fechado não aceita reserva'
);
select is(
  tests.book('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e3', tests.today() + 3) ->> 'code',
  'MARKET_INACTIVE',
  'mercado arquivado não aceita reserva'
);
select is(
  tests.book('00000000-0000-0000-0000-0000000000a1', gen_random_uuid(), tests.today() + 3) ->> 'code',
  'MARKET_INACTIVE',
  'mercado que não existe também é MARKET_INACTIVE'
);
select is(
  tests.book('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e2', tests.today()) ->> 'code',
  'OUT_OF_WINDOW',
  'hoje não se reserva'
);
select is(
  tests.book('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e2', tests.today() + 61) ->> 'code',
  'OUT_OF_WINDOW',
  'um dia além da janela de 60 não se reserva'
);
select is(
  tests.book('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e2', null) ->> 'code',
  'OUT_OF_WINDOW',
  'sem dia não se reserva'
);
select ok(
  (tests.book('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e2', tests.today() + 60) ->> 'ok')::boolean,
  'o último dia da janela (60) ainda reserva'
);

set local role anon;
select throws_ok(
  $$ select public.book_slot_v1('00000000-0000-0000-0000-0000000000e2', current_date + 3) $$,
  '42501', null,
  'anônimo não chama a função de reservar'
);
reset role;

select is(
  (select count(*)::int from public.audit_log
    where table_name = 'bookings' and action = 'insert'
      and actor_id = '00000000-0000-0000-0000-0000000000a1' and actor_role = 'supplier' and source = 'app'),
  2,
  'cada reserva ficou no log com quem reservou e o papel'
);

------------------------------------------------------------------ cancelar
select is(
  tests.cancel('00000000-0000-0000-0000-0000000000b1',
    (select id from public.bookings where supplier_id = '00000000-0000-0000-0000-0000000000a1' and day = tests.today() + 10)) ->> 'code',
  'NOT_FOUND',
  'o bruno não cancela a reserva da ana (e não descobre que ela existe)'
);
select is(
  tests.cancel('00000000-0000-0000-0000-0000000000a1',
    (select id from public.bookings where supplier_id = '00000000-0000-0000-0000-0000000000a1' and day = tests.today() + 10)),
  '{"ok": true, "already_cancelled": false}'::jsonb,
  'a ana cancela a própria reserva'
);
select is(
  tests.cancel('00000000-0000-0000-0000-0000000000a1',
    (select id from public.bookings where supplier_id = '00000000-0000-0000-0000-0000000000a1' and day = tests.today() + 10)),
  '{"ok": true, "already_cancelled": true}'::jsonb,
  'cancelar de novo é sucesso'
);
select ok(
  tests.book('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000e1', tests.today() + 10)
    @> '{"ok": true, "booked": 3}'::jsonb,
  'a vaga liberada pela ana vai para a dora'
);
select is(
  tests.book('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', tests.today() + 10) ->> 'code',
  'FULL',
  'a ana tenta voltar e o dia já está lotado de novo'
);

select is(
  tests.cancel('00000000-0000-0000-0000-0000000000c1',
    (select id from public.bookings where supplier_id = '00000000-0000-0000-0000-0000000000b1' and day = tests.today() + 10),
    '  Fornecedor avisou que não vem  '),
  '{"ok": true, "already_cancelled": false}'::jsonb,
  'o administrador cancela a reserva de qualquer fornecedor'
);
select is(
  (select cancel_reason from public.bookings where supplier_id = '00000000-0000-0000-0000-0000000000b1' and day = tests.today() + 10),
  'Fornecedor avisou que não vem',
  'com o motivo, sem os espaços das pontas'
);
select is(
  (select cancelled_by from public.bookings where supplier_id = '00000000-0000-0000-0000-0000000000b1' and day = tests.today() + 10),
  '00000000-0000-0000-0000-0000000000c1'::uuid,
  'e quem cancelou'
);
select is(
  tests.cancel('00000000-0000-0000-0000-0000000000a1',
    (select id from public.bookings where supplier_id = '00000000-0000-0000-0000-0000000000a1' and day = tests.today() + 60),
    'motivo que o fornecedor não grava'),
  '{"ok": true, "already_cancelled": false}'::jsonb,
  'o fornecedor cancela a outra reserva dele'
);
select is(
  (select cancel_reason from public.bookings where supplier_id = '00000000-0000-0000-0000-0000000000a1' and day = tests.today() + 60),
  null,
  'o motivo só é gravado quando é o administrador que cancela'
);

insert into public.bookings (id, market_id, day, supplier_id) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e2', tests.today() - 1, '00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000e2', tests.today(), '00000000-0000-0000-0000-0000000000a2');
select is(
  tests.cancel('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000d1') ->> 'code',
  'PAST',
  'reserva de dia que já passou é histórico: não se cancela'
);
select is(
  tests.cancel('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000d2'),
  '{"ok": true, "already_cancelled": false}'::jsonb,
  'a do próprio dia ainda se cancela'
);
select is(
  tests.cancel('00000000-0000-0000-0000-0000000000a2', gen_random_uuid()) ->> 'code',
  'NOT_FOUND',
  'reserva que não existe: NOT_FOUND'
);
set local role anon;
select throws_ok(
  $$ select public.cancel_booking_v1(gen_random_uuid()) $$,
  '42501', null,
  'anônimo não chama a função de cancelar'
);
reset role;

------------------------------------------------------------------ disponibilidade (só contagens)
-- Mercado do calendário: dia X com a ana e o bruno, X+1 com o caio, X+2 fechado.
insert into public.bookings (market_id, day, supplier_id) values
  ('00000000-0000-0000-0000-0000000000e4', tests.today() + 20, '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000e4', tests.today() + 20, '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000e4', tests.today() + 21, '00000000-0000-0000-0000-0000000000a2');
insert into public.closed_days (market_id, day) values ('00000000-0000-0000-0000-0000000000e4', tests.today() + 22);

select is(
  tests.avail('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e4', tests.today() + 20, tests.today() + 23) -> 'days',
  jsonb_build_array(
    jsonb_build_object('day', tests.today() + 20, 'booked', 2, 'closed', false, 'mine', true),
    jsonb_build_object('day', tests.today() + 21, 'booked', 1, 'closed', false, 'mine', false),
    jsonb_build_object('day', tests.today() + 22, 'booked', 0, 'closed', true, 'mine', false),
    jsonb_build_object('day', tests.today() + 23, 'booked', 0, 'closed', false, 'mine', false)
  ),
  'a ana vê as contagens, o dia fechado e quais dias são dela'
);
select is(
  tests.avail('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e4', tests.today() + 20, tests.today() + 21) -> 'days' -> 0 ->> 'mine',
  'false',
  'para o caio o dia 20 não é dele...'
);
select is(
  tests.avail('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e4', tests.today() + 20, tests.today() + 21) -> 'days' -> 1 ->> 'mine',
  'true',
  '...e o dia 21 é'
);
select ok(
  position('00000000-0000-0000-0000-0000000000a1' in tests.avail('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e4', tests.today() + 20, tests.today() + 23)::text) = 0
  and position('ana@test.dev' in tests.avail('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e4', tests.today() + 20, tests.today() + 23)::text) = 0,
  'a resposta não traz id nem nome de outro fornecedor'
);
select is(
  tests.avail('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e4', tests.today() + 20, tests.today() + 20) -> 'days' -> 0 ->> 'mine',
  'false',
  'o administrador também consulta (e nenhum dia é "dele")'
);
select ok(
  tests.avail('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e4', tests.today() + 20, tests.today() + 20)
    @> jsonb_build_object('ok', true, 'today', tests.today(), 'capacity', 3, 'archived', false),
  'devolve o "hoje" do servidor, o limite e se o mercado está arquivado'
);
select ok(
  tests.avail('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e3', tests.today() + 1, tests.today() + 1) @> '{"archived": true}'::jsonb,
  'mercado arquivado aparece como arquivado'
);
select is(
  tests.avail('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e4', tests.today() + 5, tests.today() + 4) ->> 'code',
  'INVALID_RANGE',
  'intervalo invertido'
);
select is(
  tests.avail('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e4', tests.today(), tests.today() + 93) ->> 'code',
  'INVALID_RANGE',
  'intervalo maior que 92 dias'
);
select is(
  tests.avail('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e4', null, tests.today()) ->> 'code',
  'INVALID_RANGE',
  'intervalo sem data'
);
select is(
  tests.avail('00000000-0000-0000-0000-0000000000a1', gen_random_uuid(), tests.today(), tests.today() + 1) ->> 'code',
  'MARKET_NOT_FOUND',
  'mercado que não existe'
);
set local role anon;
select throws_ok(
  $$ select public.market_availability_v1('00000000-0000-0000-0000-0000000000e4', current_date, current_date + 1) $$,
  '42501', null,
  'anônimo não consulta a disponibilidade'
);
reset role;

select * from finish();
rollback;
