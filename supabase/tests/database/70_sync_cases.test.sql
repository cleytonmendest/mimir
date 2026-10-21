-- GERADO por scripts/gen-sync-cases.ts a partir de src/domain/fixtures/visit-events.cases.json.
-- Não edite: mude o caso no JSON e rode "npm run db:gen-cases".
-- Cada caso monta uma visita, chama sync_visit_events_v1 como o repositor e confere o que foi
-- aplicado, o que foi recusado (e por quê) e como a visita ficou. É o mesmo contrato que o domínio
-- cumpre em src/domain/visit-events.cases.test.ts.
begin;

select plan(37);


create schema tests;

create function tests.make_user(uid uuid, mail text)
returns void language plpgsql as $$
begin
  insert into auth.users (id, email) values (uid, mail);
  update public.profiles set full_name = mail where id = uid;
end;
$$;

create function tests.login_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;

create function tests.utc(ts timestamptz) returns text language sql immutable as $$
  select to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

-- Monta o caso n (uma visita da ana e um mercado só dele), envia os eventos como "who" e devolve o
-- resumo na mesma forma do campo "expect" do JSON.
create function tests.run_case(n int, who uuid, visit jsonb, events jsonb) returns jsonb
language plpgsql as $$
declare
  market uuid := md5('market' || n)::uuid;
  visit_id uuid := md5('visit' || n)::uuid;
  ids uuid[] := array(
    select md5('event' || n || '-' || (g - 1))::uuid from generate_series(1, jsonb_array_length(events)) g
  );
  payload jsonb;
  response jsonb;
begin
  insert into public.markets (id, name) values (market, 'Mercado ' || n);
  insert into public.visits (id, repositor_id, market_id, visit_date, status, check_in_at, check_out_at, note, skip_reason)
  values (
    visit_id, '00000000-0000-0000-0000-0000000000a1', market, (visit ->> 'date')::date, (visit ->> 'status')::public.visit_status,
    (visit ->> 'checkInAt')::timestamptz, (visit ->> 'checkOutAt')::timestamptz,
    visit ->> 'note', visit ->> 'skipReason'
  );

  select jsonb_agg(
           jsonb_strip_nulls(jsonb_build_object(
             'client_event_id', ids[e.ordinality],
             'visit_id', visit_id,
             'seq', coalesce((e.value ->> 'seq')::int, e.ordinality::int),
             'type', e.value ->> 'type',
             'occurred_at', e.value ->> 'occurredAt',
             'note', e.value -> 'note',
             'reason', e.value -> 'reason'
           ))
           order by e.ordinality
         )
    into payload
    from jsonb_array_elements(events) with ordinality as e(value, ordinality);

  perform tests.login_as(who);
  response := public.sync_visit_events_v1('00000000-0000-0000-0000-00000000d001', '9.9.9+test', payload);
  reset role;

  return jsonb_build_object(
    'applied', coalesce((
      select jsonb_agg(array_position(ids, (r ->> 'client_event_id')::uuid) - 1
                       order by array_position(ids, (r ->> 'client_event_id')::uuid))
        from jsonb_array_elements(response -> 'results') r
       where r ->> 'status' = 'applied'
    ), '[]'::jsonb),
    'rejected', coalesce((
      select jsonb_agg(jsonb_build_object('event', array_position(ids, (r ->> 'client_event_id')::uuid) - 1, 'code', r ->> 'code')
                       order by array_position(ids, (r ->> 'client_event_id')::uuid))
        from jsonb_array_elements(response -> 'results') r
       where r ->> 'status' = 'rejected'
    ), '[]'::jsonb),
    'visit', (
      select jsonb_build_object(
        'status', v.status,
        'checkInAt', tests.utc(v.check_in_at),
        'checkOutAt', tests.utc(v.check_out_at),
        'note', v.note,
        'skipReason', v.skip_reason
      )
      from public.visits v where v.id = visit_id
    )
  );
end;
$$;

select tests.make_user('00000000-0000-0000-0000-0000000000a1', 'ana@test.dev');
select tests.make_user('00000000-0000-0000-0000-0000000000b1', 'bruno@test.dev');

select is(
  tests.run_case(1, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-18","status":"planned","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}$q$::jsonb, $q$[{"type":"checkIn","occurredAt":"2026-03-18T12:00:00.000Z"}]$q$::jsonb),
  $q${"applied":[0],"rejected":[],"visit":{"status":"in_progress","checkInAt":"2026-03-18T12:00:00.000Z","checkOutAt":null,"note":null,"skipReason":null}}$q$::jsonb,
  $q$check-in no dia da visita$q$
);

select is(
  tests.run_case(2, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-19","status":"planned","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}$q$::jsonb, $q$[{"type":"checkIn","occurredAt":"2026-03-18T12:00:00.000Z"}]$q$::jsonb),
  $q${"applied":[],"rejected":[{"event":0,"code":"VISIT_IN_FUTURE"}],"visit":{"status":"planned","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}}$q$::jsonb,
  $q$check-in de visita de amanhã$q$
);

select is(
  tests.run_case(3, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-17","status":"planned","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}$q$::jsonb, $q$[{"type":"checkIn","occurredAt":"2026-03-18T12:00:00.000Z"}]$q$::jsonb),
  $q${"applied":[],"rejected":[{"event":0,"code":"VISIT_IN_PAST"}],"visit":{"status":"planned","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}}$q$::jsonb,
  $q$check-in de visita de ontem$q$
);

select is(
  tests.run_case(4, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-18","status":"planned","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}$q$::jsonb, $q$[{"type":"checkIn","occurredAt":"2026-03-18T02:59:59.000Z"}]$q$::jsonb),
  $q${"applied":[],"rejected":[{"event":0,"code":"VISIT_IN_FUTURE"}],"visit":{"status":"planned","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}}$q$::jsonb,
  $q$23h59 de Brasília ainda é o dia anterior$q$
);

select is(
  tests.run_case(5, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-18","status":"planned","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}$q$::jsonb, $q$[{"type":"checkIn","occurredAt":"2026-03-18T03:00:00.000Z"}]$q$::jsonb),
  $q${"applied":[0],"rejected":[],"visit":{"status":"in_progress","checkInAt":"2026-03-18T03:00:00.000Z","checkOutAt":null,"note":null,"skipReason":null}}$q$::jsonb,
  $q$00h00 de Brasília já é o dia da visita$q$
);

select is(
  tests.run_case(6, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-18","status":"planned","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}$q$::jsonb, $q$[{"type":"checkIn","occurredAt":"2026-03-19T02:59:59.000Z"}]$q$::jsonb),
  $q${"applied":[0],"rejected":[],"visit":{"status":"in_progress","checkInAt":"2026-03-19T02:59:59.000Z","checkOutAt":null,"note":null,"skipReason":null}}$q$::jsonb,
  $q$23h59 de Brasília é o último instante do dia da visita$q$
);

select is(
  tests.run_case(7, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-18","status":"planned","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}$q$::jsonb, $q$[{"type":"checkIn","occurredAt":"2026-03-19T03:00:00.000Z"}]$q$::jsonb),
  $q${"applied":[],"rejected":[{"event":0,"code":"VISIT_IN_PAST"}],"visit":{"status":"planned","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}}$q$::jsonb,
  $q$00h00 do dia seguinte já é tarde para o check-in$q$
);

select is(
  tests.run_case(8, '00000000-0000-0000-0000-0000000000b1', $q${"date":"2026-03-18","status":"planned","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}$q$::jsonb, $q$[{"type":"checkIn","occurredAt":"2026-03-18T12:00:00.000Z"}]$q$::jsonb),
  $q${"applied":[],"rejected":[{"event":0,"code":"FORBIDDEN"}],"visit":{"status":"planned","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}}$q$::jsonb,
  $q$o repositor só inicia as próprias visitas$q$
);

select is(
  tests.run_case(9, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-18","status":"planned","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}$q$::jsonb, $q$[{"type":"checkOut","occurredAt":"2026-03-18T12:40:00.000Z"}]$q$::jsonb),
  $q${"applied":[],"rejected":[{"event":0,"code":"INVALID_TRANSITION"}],"visit":{"status":"planned","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}}$q$::jsonb,
  $q$check-out com a visita em "planned"$q$
);

select is(
  tests.run_case(10, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-18","status":"in_progress","checkInAt":"2026-03-18T12:00:00.000Z","checkOutAt":null,"note":null,"skipReason":null}$q$::jsonb, $q$[{"type":"checkIn","occurredAt":"2026-03-18T12:40:00.000Z"}]$q$::jsonb),
  $q${"applied":[],"rejected":[{"event":0,"code":"INVALID_TRANSITION"}],"visit":{"status":"in_progress","checkInAt":"2026-03-18T12:00:00.000Z","checkOutAt":null,"note":null,"skipReason":null}}$q$::jsonb,
  $q$check-in com a visita em "in_progress"$q$
);

select is(
  tests.run_case(11, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-18","status":"done","checkInAt":"2026-03-18T12:00:00.000Z","checkOutAt":"2026-03-18T12:40:00.000Z","note":"Gôndola ok","skipReason":null}$q$::jsonb, $q$[{"type":"checkIn","occurredAt":"2026-03-18T12:40:00.000Z"}]$q$::jsonb),
  $q${"applied":[],"rejected":[{"event":0,"code":"INVALID_TRANSITION"}],"visit":{"status":"done","checkInAt":"2026-03-18T12:00:00.000Z","checkOutAt":"2026-03-18T12:40:00.000Z","note":"Gôndola ok","skipReason":null}}$q$::jsonb,
  $q$check-in com a visita em "done"$q$
);

select is(
  tests.run_case(12, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-18","status":"done","checkInAt":"2026-03-18T12:00:00.000Z","checkOutAt":"2026-03-18T12:40:00.000Z","note":"Gôndola ok","skipReason":null}$q$::jsonb, $q$[{"type":"checkOut","occurredAt":"2026-03-18T12:40:00.000Z"}]$q$::jsonb),
  $q${"applied":[],"rejected":[{"event":0,"code":"INVALID_TRANSITION"}],"visit":{"status":"done","checkInAt":"2026-03-18T12:00:00.000Z","checkOutAt":"2026-03-18T12:40:00.000Z","note":"Gôndola ok","skipReason":null}}$q$::jsonb,
  $q$check-out com a visita em "done"$q$
);

select is(
  tests.run_case(13, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-18","status":"done","checkInAt":"2026-03-18T12:00:00.000Z","checkOutAt":"2026-03-18T12:40:00.000Z","note":"Gôndola ok","skipReason":null}$q$::jsonb, $q$[{"type":"markNotDone","occurredAt":"2026-03-18T12:40:00.000Z","reason":"Sem estoque"}]$q$::jsonb),
  $q${"applied":[],"rejected":[{"event":0,"code":"INVALID_TRANSITION"}],"visit":{"status":"done","checkInAt":"2026-03-18T12:00:00.000Z","checkOutAt":"2026-03-18T12:40:00.000Z","note":"Gôndola ok","skipReason":null}}$q$::jsonb,
  $q$"não fui" com a visita em "done"$q$
);

select is(
  tests.run_case(14, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-18","status":"not_done","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":"Mercado fechado"}$q$::jsonb, $q$[{"type":"checkIn","occurredAt":"2026-03-18T12:40:00.000Z"}]$q$::jsonb),
  $q${"applied":[],"rejected":[{"event":0,"code":"INVALID_TRANSITION"}],"visit":{"status":"not_done","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":"Mercado fechado"}}$q$::jsonb,
  $q$check-in com a visita em "not_done"$q$
);

select is(
  tests.run_case(15, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-18","status":"not_done","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":"Mercado fechado"}$q$::jsonb, $q$[{"type":"checkOut","occurredAt":"2026-03-18T12:40:00.000Z"}]$q$::jsonb),
  $q${"applied":[],"rejected":[{"event":0,"code":"INVALID_TRANSITION"}],"visit":{"status":"not_done","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":"Mercado fechado"}}$q$::jsonb,
  $q$check-out com a visita em "not_done"$q$
);

select is(
  tests.run_case(16, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-18","status":"not_done","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":"Mercado fechado"}$q$::jsonb, $q$[{"type":"markNotDone","occurredAt":"2026-03-18T12:40:00.000Z","reason":"Sem estoque"}]$q$::jsonb),
  $q${"applied":[],"rejected":[{"event":0,"code":"INVALID_TRANSITION"}],"visit":{"status":"not_done","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":"Mercado fechado"}}$q$::jsonb,
  $q$"não fui" com a visita em "not_done"$q$
);

select is(
  tests.run_case(17, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-18","status":"cancelled","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}$q$::jsonb, $q$[{"type":"checkIn","occurredAt":"2026-03-18T12:40:00.000Z"}]$q$::jsonb),
  $q${"applied":[],"rejected":[{"event":0,"code":"INVALID_TRANSITION"}],"visit":{"status":"cancelled","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}}$q$::jsonb,
  $q$check-in com a visita em "cancelled"$q$
);

select is(
  tests.run_case(18, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-18","status":"cancelled","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}$q$::jsonb, $q$[{"type":"checkOut","occurredAt":"2026-03-18T12:40:00.000Z"}]$q$::jsonb),
  $q${"applied":[],"rejected":[{"event":0,"code":"INVALID_TRANSITION"}],"visit":{"status":"cancelled","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}}$q$::jsonb,
  $q$check-out com a visita em "cancelled"$q$
);

select is(
  tests.run_case(19, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-18","status":"cancelled","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}$q$::jsonb, $q$[{"type":"markNotDone","occurredAt":"2026-03-18T12:40:00.000Z","reason":"Sem estoque"}]$q$::jsonb),
  $q${"applied":[],"rejected":[{"event":0,"code":"INVALID_TRANSITION"}],"visit":{"status":"cancelled","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}}$q$::jsonb,
  $q$"não fui" com a visita em "cancelled"$q$
);

select is(
  tests.run_case(20, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-18","status":"in_progress","checkInAt":"2026-03-18T12:00:00.000Z","checkOutAt":null,"note":null,"skipReason":null}$q$::jsonb, $q$[{"type":"checkOut","occurredAt":"2026-03-18T12:40:00.000Z","note":"Tudo certo"}]$q$::jsonb),
  $q${"applied":[0],"rejected":[],"visit":{"status":"done","checkInAt":"2026-03-18T12:00:00.000Z","checkOutAt":"2026-03-18T12:40:00.000Z","note":"Tudo certo","skipReason":null}}$q$::jsonb,
  $q$check-out com observação$q$
);

select is(
  tests.run_case(21, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-18","status":"in_progress","checkInAt":"2026-03-18T12:00:00.000Z","checkOutAt":null,"note":"antes","skipReason":null}$q$::jsonb, $q$[{"type":"checkOut","occurredAt":"2026-03-18T12:40:00.000Z"}]$q$::jsonb),
  $q${"applied":[0],"rejected":[],"visit":{"status":"done","checkInAt":"2026-03-18T12:00:00.000Z","checkOutAt":"2026-03-18T12:40:00.000Z","note":"antes","skipReason":null}}$q$::jsonb,
  $q$check-out sem observação mantém a que já existia$q$
);

select is(
  tests.run_case(22, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-18","status":"in_progress","checkInAt":"2026-03-18T12:00:00.000Z","checkOutAt":null,"note":null,"skipReason":null}$q$::jsonb, $q$[{"type":"checkOut","occurredAt":"2026-03-18T11:59:59.000Z"}]$q$::jsonb),
  $q${"applied":[],"rejected":[{"event":0,"code":"CHECKOUT_BEFORE_CHECKIN"}],"visit":{"status":"in_progress","checkInAt":"2026-03-18T12:00:00.000Z","checkOutAt":null,"note":null,"skipReason":null}}$q$::jsonb,
  $q$check-out um segundo antes do check-in$q$
);

select is(
  tests.run_case(23, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-18","status":"in_progress","checkInAt":"2026-03-18T12:00:00.000Z","checkOutAt":null,"note":null,"skipReason":null}$q$::jsonb, $q$[{"type":"checkOut","occurredAt":"2026-03-18T12:00:00.000Z"}]$q$::jsonb),
  $q${"applied":[0],"rejected":[],"visit":{"status":"done","checkInAt":"2026-03-18T12:00:00.000Z","checkOutAt":"2026-03-18T12:00:00.000Z","note":null,"skipReason":null}}$q$::jsonb,
  $q$check-out na mesma hora do check-in$q$
);

select is(
  tests.run_case(24, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-17","status":"in_progress","checkInAt":"2026-03-17T12:00:00.000Z","checkOutAt":null,"note":null,"skipReason":null}$q$::jsonb, $q$[{"type":"checkOut","occurredAt":"2026-03-18T12:00:00.000Z"}]$q$::jsonb),
  $q${"applied":[0],"rejected":[],"visit":{"status":"done","checkInAt":"2026-03-17T12:00:00.000Z","checkOutAt":"2026-03-18T12:00:00.000Z","note":null,"skipReason":null}}$q$::jsonb,
  $q$check-out de uma visita aberta ontem, antes do fechamento do dia$q$
);

select is(
  tests.run_case(25, '00000000-0000-0000-0000-0000000000b1', $q${"date":"2026-03-18","status":"in_progress","checkInAt":"2026-03-18T12:00:00.000Z","checkOutAt":null,"note":null,"skipReason":null}$q$::jsonb, $q$[{"type":"checkOut","occurredAt":"2026-03-18T12:40:00.000Z"}]$q$::jsonb),
  $q${"applied":[],"rejected":[{"event":0,"code":"FORBIDDEN"}],"visit":{"status":"in_progress","checkInAt":"2026-03-18T12:00:00.000Z","checkOutAt":null,"note":null,"skipReason":null}}$q$::jsonb,
  $q$o repositor só encerra as próprias visitas$q$
);

select is(
  tests.run_case(26, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-18","status":"planned","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}$q$::jsonb, $q$[{"type":"markNotDone","occurredAt":"2026-03-18T12:00:00.000Z","reason":"  Mercado fechado "}]$q$::jsonb),
  $q${"applied":[0],"rejected":[],"visit":{"status":"not_done","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":"Mercado fechado"}}$q$::jsonb,
  $q$"não fui" com o motivo sem espaços nas pontas$q$
);

select is(
  tests.run_case(27, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-18","status":"in_progress","checkInAt":"2026-03-18T12:00:00.000Z","checkOutAt":null,"note":null,"skipReason":null}$q$::jsonb, $q$[{"type":"markNotDone","occurredAt":"2026-03-18T12:40:00.000Z","reason":"Sem estoque"}]$q$::jsonb),
  $q${"applied":[0],"rejected":[],"visit":{"status":"not_done","checkInAt":"2026-03-18T12:00:00.000Z","checkOutAt":null,"note":null,"skipReason":"Sem estoque"}}$q$::jsonb,
  $q$"não fui" com a visita em andamento$q$
);

select is(
  tests.run_case(28, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-18","status":"planned","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}$q$::jsonb, $q$[{"type":"markNotDone","occurredAt":"2026-03-18T12:00:00.000Z","reason":"   "}]$q$::jsonb),
  $q${"applied":[],"rejected":[{"event":0,"code":"REASON_REQUIRED"}],"visit":{"status":"planned","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}}$q$::jsonb,
  $q$"não fui" exige motivo$q$
);

select is(
  tests.run_case(29, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-19","status":"planned","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}$q$::jsonb, $q$[{"type":"markNotDone","occurredAt":"2026-03-18T12:00:00.000Z","reason":"Sem estoque"}]$q$::jsonb),
  $q${"applied":[],"rejected":[{"event":0,"code":"VISIT_IN_FUTURE"}],"visit":{"status":"planned","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}}$q$::jsonb,
  $q$"não fui" em visita de amanhã$q$
);

select is(
  tests.run_case(30, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-17","status":"planned","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}$q$::jsonb, $q$[{"type":"markNotDone","occurredAt":"2026-03-18T12:00:00.000Z","reason":"Sem estoque"}]$q$::jsonb),
  $q${"applied":[0],"rejected":[],"visit":{"status":"not_done","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":"Sem estoque"}}$q$::jsonb,
  $q$"não fui" em visita de ontem, antes do fechamento do dia$q$
);

select is(
  tests.run_case(31, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-17","status":"in_progress","checkInAt":"2026-03-17T12:00:00.000Z","checkOutAt":null,"note":null,"skipReason":null}$q$::jsonb, $q$[{"type":"markNotDone","occurredAt":"2026-03-18T12:00:00.000Z","reason":"Sem check-out"}]$q$::jsonb),
  $q${"applied":[0],"rejected":[],"visit":{"status":"not_done","checkInAt":"2026-03-17T12:00:00.000Z","checkOutAt":null,"note":null,"skipReason":"Sem check-out"}}$q$::jsonb,
  $q$"não fui: Sem check-out" encerra a visita aberta de ontem (check-in em outra visita)$q$
);

select is(
  tests.run_case(32, '00000000-0000-0000-0000-0000000000b1', $q${"date":"2026-03-18","status":"planned","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}$q$::jsonb, $q$[{"type":"markNotDone","occurredAt":"2026-03-18T12:00:00.000Z","reason":"Sem estoque"}]$q$::jsonb),
  $q${"applied":[],"rejected":[{"event":0,"code":"FORBIDDEN"}],"visit":{"status":"planned","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}}$q$::jsonb,
  $q$o repositor só marca "não fui" nas próprias visitas$q$
);

select is(
  tests.run_case(33, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-18","status":"planned","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}$q$::jsonb, $q$[{"type":"checkIn","occurredAt":"2026-03-18T12:00:00.000Z"},{"type":"checkOut","occurredAt":"2026-03-18T12:40:00.000Z","note":"Tudo certo"}]$q$::jsonb),
  $q${"applied":[0,1],"rejected":[],"visit":{"status":"done","checkInAt":"2026-03-18T12:00:00.000Z","checkOutAt":"2026-03-18T12:40:00.000Z","note":"Tudo certo","skipReason":null}}$q$::jsonb,
  $q$check-in e check-out em sequência$q$
);

select is(
  tests.run_case(34, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-18","status":"planned","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}$q$::jsonb, $q$[{"type":"checkOut","occurredAt":"2026-03-18T12:40:00.000Z","seq":2},{"type":"checkIn","occurredAt":"2026-03-18T12:00:00.000Z","seq":1}]$q$::jsonb),
  $q${"applied":[0,1],"rejected":[],"visit":{"status":"done","checkInAt":"2026-03-18T12:00:00.000Z","checkOutAt":"2026-03-18T12:40:00.000Z","note":null,"skipReason":null}}$q$::jsonb,
  $q$a ordem é a do seq, não a da lista nem a da hora$q$
);

select is(
  tests.run_case(35, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-18","status":"planned","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}$q$::jsonb, $q$[{"type":"checkIn","occurredAt":"2026-03-18T11:00:00.000Z","seq":2},{"type":"markNotDone","occurredAt":"2026-03-18T13:00:00.000Z","reason":"Mercado fechado","seq":1}]$q$::jsonb),
  $q${"applied":[1],"rejected":[{"event":0,"code":"INVALID_TRANSITION"}],"visit":{"status":"not_done","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":"Mercado fechado"}}$q$::jsonb,
  $q$relógio corrigido no meio do dia: o seq manda, mesmo com hora anterior$q$
);

select is(
  tests.run_case(36, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-18","status":"planned","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}$q$::jsonb, $q$[{"type":"markNotDone","occurredAt":"2026-03-18T11:00:00.000Z","reason":"  ","seq":1},{"type":"checkIn","occurredAt":"2026-03-18T12:00:00.000Z","seq":2}]$q$::jsonb),
  $q${"applied":[1],"rejected":[{"event":0,"code":"REASON_REQUIRED"}],"visit":{"status":"in_progress","checkInAt":"2026-03-18T12:00:00.000Z","checkOutAt":null,"note":null,"skipReason":null}}$q$::jsonb,
  $q$um evento recusado não impede os seguintes$q$
);

select is(
  tests.run_case(37, '00000000-0000-0000-0000-0000000000a1', $q${"date":"2026-03-18","status":"planned","checkInAt":null,"checkOutAt":null,"note":null,"skipReason":null}$q$::jsonb, $q$[{"type":"checkIn","occurredAt":"2026-03-18T12:00:00.000Z","seq":1},{"type":"checkIn","occurredAt":"2026-03-18T12:40:00.000Z","seq":2}]$q$::jsonb),
  $q${"applied":[0],"rejected":[{"event":1,"code":"INVALID_TRANSITION"}],"visit":{"status":"in_progress","checkInAt":"2026-03-18T12:00:00.000Z","checkOutAt":null,"note":null,"skipReason":null}}$q$::jsonb,
  $q$segundo check-in do mesmo lote é recusado$q$
);


select * from finish();
rollback;
