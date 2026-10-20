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

-- ana, bruno: repositores. leader: líder.
select tests.make_user('00000000-0000-0000-0000-0000000000a1', 'ana@test.dev');
select tests.make_user('00000000-0000-0000-0000-0000000000b1', 'bruno@test.dev');
select tests.make_user('00000000-0000-0000-0000-0000000000c1', 'leader@test.dev', 'leader');

insert into public.markets (id, name) values
  ('00000000-0000-0000-0000-0000000000e1', 'Mercado 1'),
  ('00000000-0000-0000-0000-0000000000e2', 'Mercado 2');

insert into public.visits (id, repositor_id, market_id, visit_date, status, check_in_at, check_out_at) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', '2026-10-21', 'planned', null, null),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e2', '2026-10-21', 'planned', null, null),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', '2026-10-20', 'done', '2026-10-20 10:00+00', '2026-10-20 11:00+00'),
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', '2026-10-21', 'planned', null, null);

------------------------------------------------------------------ como ana (repositor)
select tests.login_as('00000000-0000-0000-0000-0000000000a1');

select is((select count(*)::int from public.visits), 3, 'repositor vê só as próprias visitas');

select is(
  (select count(*)::int from public.visits where repositor_id = '00000000-0000-0000-0000-0000000000b1'),
  0,
  'repositor A não enxerga visitas do repositor B'
);

select is_empty(
  $$ with u as (update public.visits set note = 'invasão' where id = '00000000-0000-0000-0000-0000000000f4' returning id) select id from u $$,
  'repositor A não edita visita do repositor B'
);

select throws_ok(
  $$ insert into public.visits (repositor_id, market_id, visit_date)
     values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e2', '2026-10-22') $$,
  '42501', null,
  'repositor A não cria visita para o repositor B'
);

select lives_ok(
  $$ insert into public.visits (id, repositor_id, market_id, visit_date)
     values ('00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e2', '2026-10-22') $$,
  'repositor cria visita (exceção) para si'
);

select throws_ok(
  $$ insert into public.visits (repositor_id, market_id, visit_date, status, check_in_at, check_out_at)
     values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', '2026-10-23', 'done', now(), now()) $$,
  '42501', null,
  'repositor não cria visita já concluída (forjando histórico)'
);

select throws_ok(
  $$ update public.visits set repositor_id = '00000000-0000-0000-0000-0000000000b1' where id = '00000000-0000-0000-0000-0000000000f2' $$,
  '42501', null,
  'repositor não passa a própria visita para outro repositor'
);

select throws_ok(
  $$ update public.visits set status = 'planned' where id = '00000000-0000-0000-0000-0000000000f3' $$,
  '42501', null,
  'repositor não reabre visita concluída (só o líder)'
);

select throws_ok(
  $$ update public.visits set note = 'editando depois de concluída' where id = '00000000-0000-0000-0000-0000000000f3' $$,
  '42501', null,
  'repositor não altera visita já encerrada'
);

select lives_ok(
  $$ update public.visits set status = 'in_progress', check_in_at = now() where id = '00000000-0000-0000-0000-0000000000f1' $$,
  'repositor faz check-in na própria visita'
);

select lives_ok(
  $$ update public.visits set status = 'done', check_out_at = now(), note = 'ok' where id = '00000000-0000-0000-0000-0000000000f1' $$,
  'repositor faz check-out depois do check-in'
);

select throws_ok(
  $$ update public.visits set status = 'done', check_in_at = now(), check_out_at = now() where id = '00000000-0000-0000-0000-0000000000f2' $$,
  '42501', null,
  'repositor não pula o check-in (planejada → concluída direto)'
);

select throws_ok(
  $$ delete from public.visits where id = '00000000-0000-0000-0000-0000000000f2' $$,
  '42501', null,
  'repositor não apaga visita'
);

------------------------------------------------------------------ como líder
reset role;
select tests.login_as('00000000-0000-0000-0000-0000000000c1');

select is((select count(*)::int from public.visits), 5, 'líder vê as visitas de todos');

select lives_ok(
  $$ update public.visits set status = 'planned', check_in_at = null, check_out_at = null where id = '00000000-0000-0000-0000-0000000000f3' $$,
  'líder reabre visita concluída'
);

select throws_ok(
  $$ delete from public.visits where id = '00000000-0000-0000-0000-0000000000f4' $$,
  '42501', null,
  'nem o líder apaga visita pela API'
);

------------------------------------------------------------------ constraints (como dono do banco)
reset role;

select throws_ok(
  $$ insert into public.visits (repositor_id, market_id, visit_date)
     values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', '2026-10-21') $$,
  '23505', null,
  'o mesmo mercado não entra duas vezes no mesmo dia para o mesmo repositor'
);

select throws_ok(
  $$ insert into public.visits (repositor_id, market_id, visit_date, status)
     values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e2', '2026-10-25', 'not_done') $$,
  '23514', null,
  '"não foi" exige motivo'
);

select throws_ok(
  $$ insert into public.visits (repositor_id, market_id, visit_date, status)
     values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e2', '2026-10-26', 'done') $$,
  '23514', null,
  'visita concluída exige horários de entrada e saída'
);

select throws_ok(
  $$ insert into public.visits (repositor_id, market_id, visit_date, origin)
     values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e2', '2026-10-27', 'carryover') $$,
  '23514', null,
  'sobra de outro dia exige a data de origem'
);

select throws_ok(
  $$ insert into public.visits (repositor_id, market_id, visit_date, status, check_in_at, check_out_at)
     values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e2', '2026-10-28', 'done', '2026-10-28 12:00+00', '2026-10-28 11:00+00') $$,
  '23514', null,
  'check-out não pode ser antes do check-in'
);

select * from finish();
rollback;
