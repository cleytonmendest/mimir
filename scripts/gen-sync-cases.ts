import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Gera o pgTAP que confere a função do servidor (sync_visit_events_v1) contra os mesmos casos que
 * o domínio cumpre no Vitest: src/domain/fixtures/visit-events.cases.json. As regras moram em dois
 * lugares (TypeScript e SQL); este arquivo é o que impede que elas se separem.
 *
 *   npm run db:gen-cases      reescreve supabase/tests/database/70_sync_cases.test.sql
 *
 * O teste scripts/gen-sync-cases.test.ts quebra se o SQL gerado ficar desatualizado.
 */

export interface CaseEvent {
  type: string
  occurredAt: string
  seq?: number
  note?: string
  reason?: string
}

export interface SyncCase {
  name: string
  actor: 'owner' | 'other'
  visit: {
    date: string
    status: string
    checkInAt: string | null
    checkOutAt: string | null
    note: string | null
    skipReason: string | null
  }
  events: CaseEvent[]
  expect: {
    applied: number[]
    rejected: { event: number; code: string }[]
    visit: Omit<SyncCase['visit'], 'date'>
  }
}

export const CASES_FILE = new URL('../src/domain/fixtures/visit-events.cases.json', import.meta.url)
export const SQL_FILE = new URL(
  '../supabase/tests/database/70_sync_cases.test.sql',
  import.meta.url,
)

/** Dollar-quoting: o texto entra no SQL sem escapar aspas. */
function literal(text: string): string {
  if (text.includes('$q$')) throw new Error(`texto não cabe em dollar-quoting: ${text}`)
  return `$q$${text}$q$`
}

const OWNER = '00000000-0000-0000-0000-0000000000a1'
const OTHER = '00000000-0000-0000-0000-0000000000b1'

const HEADER = `-- GERADO por scripts/gen-sync-cases.ts a partir de src/domain/fixtures/visit-events.cases.json.
-- Não edite: mude o caso no JSON e rode "npm run db:gen-cases".
-- Cada caso monta uma visita, chama sync_visit_events_v1 como o repositor e confere o que foi
-- aplicado, o que foi recusado (e por quê) e como a visita ficou. É o mesmo contrato que o domínio
-- cumpre em src/domain/visit-events.cases.test.ts.
begin;
`

const SETUP = `
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
    visit_id, '${OWNER}', market, (visit ->> 'date')::date, (visit ->> 'status')::public.visit_status,
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

select tests.make_user('${OWNER}', 'ana@test.dev');
select tests.make_user('${OTHER}', 'bruno@test.dev');
`

export function generateSyncCasesSql(cases: readonly SyncCase[]): string {
  const asserts = cases.map((item, index) => {
    const who = item.actor === 'owner' ? OWNER : OTHER
    const { visit, events } = item
    return `select is(
  tests.run_case(${index + 1}, '${who}', ${literal(JSON.stringify(visit))}::jsonb, ${literal(
    JSON.stringify(events),
  )}::jsonb),
  ${literal(JSON.stringify(item.expect))}::jsonb,
  ${literal(item.name)}
);
`
  })

  return [
    HEADER,
    `select plan(${cases.length});\n`,
    SETUP,
    ...asserts,
    '\nselect * from finish();\nrollback;\n',
  ].join('\n')
}

export function readCases(): SyncCase[] {
  const { cases } = JSON.parse(readFileSync(CASES_FILE, 'utf8')) as { cases: SyncCase[] }
  return cases
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(SQL_FILE, generateSyncCasesSql(readCases()))
  console.log(`escrito ${fileURLToPath(SQL_FILE)}`)
}
