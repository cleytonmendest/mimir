begin;
select plan(46);

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

-- Id do evento n, sempre o mesmo para o mesmo n.
create function tests.eid(n int) returns uuid language sql immutable as $$
  select md5('event' || n)::uuid;
$$;

create function tests.ev(n int, visit uuid, kind text, at text, extra jsonb default '{}'::jsonb)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'client_event_id', tests.eid(n), 'visit_id', visit, 'type', kind, 'occurred_at', at, 'seq', n
  ) || extra;
$$;

-- Envia como "who", de um aparelho, e devolve a resposta inteira.
create function tests.sync(
  who uuid,
  events jsonb,
  version text default '9.9.9+test',
  device uuid default '00000000-0000-0000-0000-00000000d001'
) returns jsonb language plpgsql as $$
declare
  response jsonb;
begin
  perform tests.login_as(who);
  response := public.sync_visit_events_v1(device, version, events);
  reset role;
  return response;
end;
$$;

create function tests.first_code(response jsonb) returns text language sql immutable as $$
  select response -> 'results' -> 0 ->> 'code';
$$;

create function tests.first_status(response jsonb) returns text language sql immutable as $$
  select response -> 'results' -> 0 ->> 'status';
$$;

select tests.make_user('00000000-0000-0000-0000-0000000000a1', 'ana@test.dev');
select tests.make_user('00000000-0000-0000-0000-0000000000b1', 'bruno@test.dev');
select tests.make_user('00000000-0000-0000-0000-0000000000c1', 'leader@test.dev', 'leader');

insert into public.markets (id, name) values
  ('00000000-0000-0000-0000-0000000000e1', 'Mercado 1'),
  ('00000000-0000-0000-0000-0000000000e2', 'Mercado 2'),
  ('00000000-0000-0000-0000-0000000000e3', 'Mercado 3'),
  ('00000000-0000-0000-0000-0000000000e4', 'Mercado 4'),
  ('00000000-0000-0000-0000-0000000000e5', 'Mercado 5');

-- f1, f2, f3, f5, f6: da ana. f4: do bruno. Todas de 18/03/2026.
insert into public.visits (id, repositor_id, market_id, visit_date) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', '2026-03-18'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e2', '2026-03-18'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e3', '2026-03-18'),
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', '2026-03-18'),
  ('00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e4', '2026-03-18'),
  ('00000000-0000-0000-0000-0000000000f6', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e5', '2026-03-18');

------------------------------------------------------------------ aplicar e reenviar (idempotência)
select is(
  tests.first_status(tests.sync(
    '00000000-0000-0000-0000-0000000000a1',
    jsonb_build_array(tests.ev(1, '00000000-0000-0000-0000-0000000000f1', 'checkIn', '2026-03-18T12:00:00.000Z'))
  )),
  'applied',
  'o check-in pela função de sincronização é aplicado'
);

select is(
  tests.sync(
    '00000000-0000-0000-0000-0000000000a1',
    jsonb_build_array(tests.ev(1, '00000000-0000-0000-0000-0000000000f1', 'checkIn', '2026-03-18T12:00:00.000Z'))
  ) -> 'results' -> 0 ->> 'duplicate',
  'true',
  'reenviar o mesmo evento devolve o resultado já decidido, marcado como repetido'
);

select is(
  (select count(*)::int from public.visit_events where client_event_id = tests.eid(1)),
  1,
  'o reenvio não grava o evento outra vez'
);

select is(
  (select count(*)::int from public.audit_log
    where table_name = 'visits' and row_id = '00000000-0000-0000-0000-0000000000f1' and action = 'update'),
  1,
  'o reenvio não mexe na visita de novo: uma só entrada de auditoria'
);

select is(
  (select source from public.audit_log
    where table_name = 'visits' and row_id = '00000000-0000-0000-0000-0000000000f1' and action = 'update'),
  'sync',
  'a auditoria diz que a mudança veio da sincronização'
);

select is(
  (select actor_id from public.audit_log
    where table_name = 'visits' and row_id = '00000000-0000-0000-0000-0000000000f1' and action = 'update'),
  '00000000-0000-0000-0000-0000000000a1'::uuid,
  'e quem agiu continua sendo o repositor, não a função'
);

select is(
  (select to_jsonb(e) - 'id' - 'received_at' from public.visit_events e where e.client_event_id = tests.eid(1)),
  jsonb_build_object(
    'client_event_id', tests.eid(1),
    'visit_id', '00000000-0000-0000-0000-0000000000f1'::uuid,
    'actor_id', '00000000-0000-0000-0000-0000000000a1'::uuid,
    'type', 'checkIn',
    'occurred_at', '2026-03-18T12:00:00+00:00',
    'occurred_local_date', '2026-03-18',
    'payload', '{}'::jsonb,
    'outcome', 'applied',
    'rejection_code', null,
    'device_id', '00000000-0000-0000-0000-00000000d001'::uuid,
    'device_seq', 1,
    'client_version', '9.9.9+test'
  ),
  'o evento guarda o resultado, o aparelho, a ordem no aparelho e a versão do app'
);

------------------------------------------------------------------ o que o aparelho manda junto, e o que o servidor decide
select tests.sync(
  '00000000-0000-0000-0000-0000000000a1',
  jsonb_build_array(tests.ev(2, '00000000-0000-0000-0000-0000000000f2', 'checkIn', '2026-03-18T12:00:00.000Z',
                             jsonb_build_object('caused_by', tests.eid(1))))
);
select is(
  (select payload from public.visit_events where client_event_id = tests.eid(2)),
  jsonb_build_object('caused_by', tests.eid(1)),
  'o evento derivado guarda qual evento o causou'
);

select tests.sync(
  '00000000-0000-0000-0000-0000000000a1',
  jsonb_build_array(tests.ev(3, '00000000-0000-0000-0000-0000000000f2', 'checkOut', '2026-03-18T12:30:00.000Z',
                             '{"note": "ok"}'::jsonb))
);
select is(
  (select payload from public.visit_events where client_event_id = tests.eid(3)),
  '{"note": "ok"}'::jsonb,
  'a observação do check-out fica no evento'
);

-- 02:59:59Z de 18/03 ainda é 17/03 em Brasília: a visita de 18/03 é "de amanhã".
select is(
  tests.first_code(tests.sync(
    '00000000-0000-0000-0000-0000000000a1',
    jsonb_build_array(tests.ev(4, '00000000-0000-0000-0000-0000000000f3', 'checkIn', '2026-03-18T02:59:59.000Z'))
  )),
  'VISIT_IN_FUTURE',
  'o dia do evento é o de Brasília, calculado a partir do instante'
);
select is(
  (select occurred_local_date from public.visit_events where client_event_id = tests.eid(4)),
  '2026-03-17'::date,
  'o dia gravado no evento é o calculado pelo servidor'
);
select is(
  (select outcome || ':' || rejection_code from public.visit_events where client_event_id = tests.eid(4)),
  'rejected:VISIT_IN_FUTURE',
  'o evento recusado também fica gravado, com o motivo'
);

select is(
  tests.first_code(tests.sync(
    '00000000-0000-0000-0000-0000000000a1',
    jsonb_build_array(tests.ev(4, '00000000-0000-0000-0000-0000000000f3', 'checkIn', '2026-03-18T02:59:59.000Z'))
  )),
  'VISIT_IN_FUTURE',
  'reenviar um evento recusado devolve a mesma recusa'
);

------------------------------------------------------------------ conflito de id e visita dos outros
select is(
  tests.first_code(tests.sync(
    '00000000-0000-0000-0000-0000000000b1',
    jsonb_build_array(tests.ev(1, '00000000-0000-0000-0000-0000000000f4', 'checkIn', '2026-03-18T12:00:00.000Z'))
  )),
  'ID_CONFLICT',
  'o id de evento de outra pessoa não é aceito'
);
select is(
  (select actor_id from public.visit_events where client_event_id = tests.eid(1)),
  '00000000-0000-0000-0000-0000000000a1'::uuid,
  'e o evento original continua como estava'
);
select is(
  tests.first_code(tests.sync(
    '00000000-0000-0000-0000-0000000000a1',
    jsonb_build_array(tests.ev(1, '00000000-0000-0000-0000-0000000000f3', 'checkIn', '2026-03-18T12:00:00.000Z'))
  )),
  'ID_CONFLICT',
  'o mesmo id em outra visita também é conflito'
);

select is(
  tests.first_code(tests.sync(
    '00000000-0000-0000-0000-0000000000b1',
    jsonb_build_array(tests.ev(5, '00000000-0000-0000-0000-0000000000f1', 'checkOut', '2026-03-18T12:40:00.000Z'))
  )),
  'FORBIDDEN',
  'o repositor não registra evento na visita de outro'
);
select is(
  (select count(*)::int from public.visit_events where client_event_id = tests.eid(5)),
  0,
  'e a tentativa não deixa rastro na visita de quem não é o dono'
);
select is(
  jsonb_array_length(tests.sync(
    '00000000-0000-0000-0000-0000000000b1',
    jsonb_build_array(tests.ev(6, '00000000-0000-0000-0000-0000000000f1', 'checkOut', '2026-03-18T12:40:00.000Z'))
  ) -> 'visits'),
  0,
  'a resposta nunca traz visitas que não são do repositor'
);
select is(
  tests.first_code(tests.sync(
    '00000000-0000-0000-0000-0000000000c1',
    jsonb_build_array(tests.ev(7, '00000000-0000-0000-0000-0000000000f1', 'markNotDone', '2026-03-18T12:40:00.000Z',
                               '{"reason": "x"}'::jsonb))
  )),
  'FORBIDDEN',
  'nem o líder usa a sincronização do aparelho na visita de outro'
);
select is(
  tests.first_code(tests.sync(
    '00000000-0000-0000-0000-0000000000a1',
    jsonb_build_array(tests.ev(8, '00000000-0000-0000-0000-0000000000ff', 'checkIn', '2026-03-18T12:00:00.000Z'))
  )),
  'VISIT_NOT_FOUND',
  'visita que não existe'
);
select is(
  (select count(*)::int from public.visit_events where client_event_id in (tests.eid(7), tests.eid(8))),
  0,
  'recusa de visita alheia ou inexistente não vira linha de evento'
);

------------------------------------------------------------------ lixo no lote
select is(
  tests.sync(
    '00000000-0000-0000-0000-0000000000a1',
    jsonb_build_array(
      '{"client_event_id": "nao-e-uuid", "seq": 1, "visit_id": "00000000-0000-0000-0000-0000000000f3",
        "type": "checkIn", "occurred_at": "2026-03-18T12:00:00.000Z"}'::jsonb,
      tests.ev(9, '00000000-0000-0000-0000-0000000000f3', 'markNotDone', '2026-03-18T15:00:00.000Z',
               '{"reason": "x"}'::jsonb)
    )
  ) -> 'results' -> 0 ->> 'client_event_id',
  'nao-e-uuid',
  'um evento com id inválido volta recusado, com o id como veio'
);
select is(
  (select status::text from public.visits where id = '00000000-0000-0000-0000-0000000000f3'),
  'not_done',
  'e o evento válido do mesmo lote foi aplicado'
);

select is(
  (select jsonb_agg(r ->> 'code') from jsonb_array_elements(tests.sync(
    '00000000-0000-0000-0000-0000000000a1',
    jsonb_build_array(
      tests.ev(10, '00000000-0000-0000-0000-0000000000f5', 'checkIn', 'now'),
      tests.ev(11, '00000000-0000-0000-0000-0000000000f5', 'explode', '2026-03-18T13:00:00.000Z'),
      tests.ev(12, '00000000-0000-0000-0000-0000000000f5', 'checkIn', '2026-03-18T13:00:00.000Z') - 'seq',
      tests.ev(13, '00000000-0000-0000-0000-0000000000f5', 'checkIn', '2026-03-18 13:00:00+00')
    )
  ) -> 'results') r),
  '["INVALID_DATA", "INVALID_DATA", "INVALID_DATA", "INVALID_DATA"]'::jsonb,
  'instante fora do padrão ISO, tipo desconhecido e seq ausente são dados inválidos'
);
select is(
  (select count(*)::int from public.visit_events where client_event_id in (tests.eid(10), tests.eid(11), tests.eid(12), tests.eid(13))),
  0,
  'dado inválido não vira linha de evento'
);

------------------------------------------------------------------ relógio do aparelho
select is(
  tests.first_code(tests.sync(
    '00000000-0000-0000-0000-0000000000a1',
    jsonb_build_array(tests.ev(14, '00000000-0000-0000-0000-0000000000f5', 'checkIn',
      to_char((now() + interval '1 hour') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
  )),
  'CLOCK_INVALID',
  'evento no futuro (relógio do aparelho adiantado) é recusado'
);
select is(
  (select status::text from public.visits where id = '00000000-0000-0000-0000-0000000000f5'),
  'planned',
  'e a visita não muda'
);
select is(
  (select rejection_code from public.visit_events where client_event_id = tests.eid(14)),
  'CLOCK_INVALID',
  'a recusa fica gravada com o motivo'
);

------------------------------------------------------------------ texto muito longo
select tests.sync(
  '00000000-0000-0000-0000-0000000000a1',
  jsonb_build_array(
    tests.ev(16, '00000000-0000-0000-0000-0000000000f6', 'checkIn', '2026-03-18T12:00:00.000Z'),
    tests.ev(17, '00000000-0000-0000-0000-0000000000f6', 'checkOut', '2026-03-18T12:30:00.000Z',
             jsonb_build_object('note', repeat('x', 5000)))
  )
);
select is(
  (select length(note) from public.visits where id = '00000000-0000-0000-0000-0000000000f6'),
  4000,
  'observação gigante é cortada em vez de recusada: o check-out não se perde'
);

------------------------------------------------------------------ versão mínima do app
update public.app_config set min_client_version = '2.0.0';

select is(
  tests.sync(
    '00000000-0000-0000-0000-0000000000a1',
    jsonb_build_array(tests.ev(15, '00000000-0000-0000-0000-0000000000f5', 'checkIn', '2026-03-18T13:00:00.000Z')),
    '1.9.9+abc1234'
  ) - 'server_now',
  '{"upgrade_required": true, "min_client_version": "2.0.0"}'::jsonb,
  'app abaixo da versão mínima recebe "atualize", sem processar nada'
);
select is(
  (select count(*)::int from public.visit_events where client_event_id = tests.eid(15)),
  0,
  'e nenhum evento é gravado'
);
select is(
  tests.first_status(tests.sync(
    '00000000-0000-0000-0000-0000000000a1',
    jsonb_build_array(tests.ev(15, '00000000-0000-0000-0000-0000000000f5', 'checkIn', '2026-03-18T13:00:00.000Z')),
    '10.0.0+abc1234'
  )),
  'applied',
  'a versão se compara como número (10.0.0 é maior que 2.0.0)'
);

------------------------------------------------------------------ limites e erros do chamador
select throws_ok(
  $$ select tests.sync('00000000-0000-0000-0000-0000000000a1',
       (select jsonb_agg(tests.ev(g, '00000000-0000-0000-0000-0000000000f1', 'checkIn', '2026-03-18T12:00:00.000Z'))
          from generate_series(1, 51) g)) $$,
  '54000', null,
  'mais de 50 eventos num envio não é aceito'
);
reset role;
select throws_ok(
  $$ select tests.sync('00000000-0000-0000-0000-0000000000a1', '{}'::jsonb) $$,
  '22023', null,
  'a lista de eventos precisa ser uma lista'
);
reset role;
select throws_ok(
  $$ select tests.sync('00000000-0000-0000-0000-0000000000a1', '[]'::jsonb, '1.0.0', null) $$,
  '22023', null,
  'sem identificação do aparelho não há sincronização'
);
reset role;

set local role anon;
select throws_ok(
  $$ select public.sync_visit_events_v1('00000000-0000-0000-0000-00000000d001', '9.9.9', '[]'::jsonb) $$,
  '42501', null,
  'anônimo não chama a sincronização'
);
reset role;

select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.sync_visit_events_v1('00000000-0000-0000-0000-00000000d001', '9.9.9', '[]'::jsonb) $$,
  '42501', null,
  'sem usuário na sessão não há sincronização'
);
reset role;

select tests.login_as('00000000-0000-0000-0000-0000000000a1');
select throws_ok(
  $$ select public.apply_visit_event('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000d001', '9.9.9', '{}'::jsonb) $$,
  '42501', null,
  'a função que aplica um evento não é chamável de fora'
);
select throws_ok(
  $$ select public.safe_uuid('x') $$,
  '42501', null,
  'nem as funções de apoio'
);
reset role;

------------------------------------------------------------------ aparelhos e configuração
select is(
  (select count(*)::int from public.device_status where user_id = '00000000-0000-0000-0000-0000000000a1'),
  1,
  'o aparelho da ana aparece uma vez, por mais envios que tenha feito'
);
select is(
  (select client_version from public.device_status where user_id = '00000000-0000-0000-0000-0000000000a1'),
  '10.0.0+abc1234',
  'e guarda a versão do último envio'
);

select tests.login_as('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.device_status), 1, 'o repositor só vê os próprios aparelhos');
reset role;

select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select is((select count(*)::int from public.device_status), 3, 'o líder vê os aparelhos de todos');
reset role;

select tests.login_as('00000000-0000-0000-0000-0000000000a1');
select is(
  (select min_client_version from public.app_config),
  '2.0.0',
  'qualquer usuário logado lê a versão mínima do app'
);
select throws_ok(
  $$ update public.app_config set min_client_version = '0.0.0' $$,
  '42501', null,
  'mas ninguém altera a configuração pela API'
);
reset role;

select * from finish();
rollback;
