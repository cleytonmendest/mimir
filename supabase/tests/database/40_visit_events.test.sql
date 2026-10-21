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

insert into public.markets (id, name) values ('00000000-0000-0000-0000-0000000000e1', 'Mercado 1');
insert into public.visits (id, repositor_id, market_id, visit_date) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', '2026-03-18'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', '2026-03-18');

select tests.login_as('00000000-0000-0000-0000-0000000000a1');

select lives_ok(
  $$ select public.sync_visit_events_v1('00000000-0000-0000-0000-00000000d001', '9.9.9+test', jsonb_build_array(
       jsonb_build_object('client_event_id', '11111111-1111-1111-1111-111111111111', 'seq', 1,
         'visit_id', '00000000-0000-0000-0000-0000000000f1', 'type', 'checkIn',
         'occurred_at', '2026-03-18T12:00:00.000Z'))) $$,
  'repositor registra evento na própria visita, pela função de sincronização'
);

select throws_ok(
  $$ insert into public.visit_events (client_event_id, visit_id, actor_id, type, occurred_at, occurred_local_date)
     values ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-0000000000f1',
             '00000000-0000-0000-0000-0000000000a1', 'checkIn', '2026-03-18 12:00+00', '2026-03-18') $$,
  '42501', null,
  'ninguém grava evento direto na tabela: a via é a função, que decide e audita'
);

select throws_ok(
  $$ update public.visit_events set type = 'checkOut' $$,
  '42501', null,
  'evento gravado não pode ser alterado'
);

select throws_ok(
  $$ delete from public.visit_events $$,
  '42501', null,
  'evento gravado não pode ser apagado'
);

select is((select count(*)::int from public.visit_events), 1, 'ana enxerga o próprio evento');

reset role;
select tests.login_as('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.visit_events), 0, 'bruno não enxerga o evento da ana');

select lives_ok(
  $$ select public.sync_visit_events_v1('00000000-0000-0000-0000-00000000d002', '9.9.9+test', jsonb_build_array(
       jsonb_build_object('client_event_id', '33333333-3333-3333-3333-333333333333', 'seq', 1,
         'visit_id', '00000000-0000-0000-0000-0000000000f1', 'type', 'checkOut',
         'occurred_at', '2026-03-18T12:40:00.000Z'))) $$,
  'bruno pode chamar a função com a visita da ana (a função recusa o evento)'
);

reset role;
select is(
  (select count(*)::int from public.visit_events where visit_id = '00000000-0000-0000-0000-0000000000f1'),
  1,
  'e a recusa não deixa evento do bruno na visita da ana'
);

select is(
  (select count(*)::int from public.visits where id = '00000000-0000-0000-0000-0000000000f1' and status = 'in_progress'),
  1,
  'a visita da ana segue como o check-in dela deixou'
);

select * from finish();
rollback;
