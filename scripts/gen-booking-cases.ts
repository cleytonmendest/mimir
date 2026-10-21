import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Gera o pgTAP que confere book_slot_v1 contra os mesmos casos que o domínio cumpre no Vitest:
 * src/domain/fixtures/booking.cases.json. A regra mora em dois lugares (TypeScript e SQL); este
 * arquivo é o que impede que se separem.
 *
 *   npm run db:gen-cases      reescreve supabase/tests/database/70_booking_cases.test.sql
 *
 * O teste scripts/gen-booking-cases.test.ts quebra se o SQL gerado ficar desatualizado.
 */

export interface BookingCase {
  name: string
  role: 'supplier' | 'admin'
  dayOffset: number
  marketArchived: boolean
  closed: boolean
  capacity: number
  booked: number
  mine: boolean
  expect: { ok: true; alreadyBooked: boolean } | { ok: false; code: string }
}

export const CASES_FILE = new URL('../src/domain/fixtures/booking.cases.json', import.meta.url)
export const SQL_FILE = new URL(
  '../supabase/tests/database/70_booking_cases.test.sql',
  import.meta.url,
)

/** Dollar-quoting: o texto entra no SQL sem escapar aspas. */
function literal(text: string): string {
  if (text.includes('$q$')) throw new Error(`texto não cabe em dollar-quoting: ${text}`)
  return `$q$${text}$q$`
}

/** O que a função devolve, em SQL: ok, e already_booked ou code. */
export function expectedJson(expected: BookingCase['expect']): string {
  return JSON.stringify(
    expected.ok
      ? { ok: true, already_booked: expected.alreadyBooked }
      : { ok: false, code: expected.code },
  )
}

/** Fornecedores de apoio (a_1 ... a_21) e um administrador. O ator de cada caso é o primeiro. */
export const POOL_SIZE = 21
const ADMIN = '00000000-0000-0000-0000-0000000000c1'

const HEADER = `-- GERADO por scripts/gen-booking-cases.ts a partir de src/domain/fixtures/booking.cases.json.
-- Não edite: mude o caso no JSON e rode "npm run db:gen-cases".
-- Cada caso monta um mercado, um dia e as reservas, chama book_slot_v1 como o fornecedor (ou o
-- administrador) e confere a decisão. É o mesmo contrato que o domínio cumpre em
-- src/domain/booking.cases.test.ts.
`

const SETUP = `create schema tests;

create function tests.login_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;

-- Fornecedores 1..${POOL_SIZE}, nascidos como supplier, e um administrador.
do $$
begin
  for n in 1..${POOL_SIZE} loop
    insert into auth.users (id, email)
      values (('00000000-0000-0000-0001-' || lpad(n::text, 12, '0'))::uuid, 'fornecedor' || n || '@test.dev');
  end loop;
  insert into auth.users (id, email) values ('${ADMIN}', 'admin@test.dev');
  update public.profiles set role = 'admin' where id = '${ADMIN}';
end;
$$;

-- Um caso: mercado novo, reservas montadas como dono do banco, e a chamada como o ator.
-- Monta com o limite no teto e só depois ajusta, para poder ter mais reservas do que o limite novo.
create function tests.run_case(
  p_role text, p_offset integer, p_archived boolean, p_closed boolean,
  p_capacity integer, p_booked integer, p_mine boolean
) returns jsonb language plpgsql as $$
declare
  market uuid := gen_random_uuid();
  day date := public.company_date(now()) + p_offset;
  actor uuid;
  result jsonb;
begin
  insert into public.markets (id, name, capacity) values (market, 'caso ' || market, 20);

  actor := case when p_role = 'admin' then '${ADMIN}'::uuid
                else '00000000-0000-0000-0001-000000000001'::uuid end;

  -- Com mine, o ator é a primeira reserva; sem mine, o ator fica de fora e as reservas são dos outros.
  for n in 1..p_booked loop
    insert into public.bookings (market_id, day, supplier_id)
      values (market, day, ('00000000-0000-0000-0001-' || lpad((case when p_mine then n else n + 1 end)::text, 12, '0'))::uuid);
  end loop;

  update public.markets set capacity = p_capacity where id = market;
  if p_archived then update public.markets set archived_at = now() where id = market; end if;
  if p_closed then insert into public.closed_days (market_id, day) values (market, day); end if;

  perform tests.login_as(actor);
  result := public.book_slot_v1(market, day);
  reset role;
  return result;
end;
$$;
`

export function generateBookingCasesSql(cases: readonly BookingCase[]): string {
  const asserts = cases.map(
    (item) => `select ok(
  tests.run_case('${item.role}', ${item.dayOffset}, ${item.marketArchived}, ${item.closed}, ${item.capacity}, ${item.booked}, ${item.mine})
    @> ${literal(expectedJson(item.expect))}::jsonb,
  ${literal(item.name)}
);
`,
  )

  return [
    HEADER,
    'begin;',
    `select plan(${cases.length});\n`,
    SETUP,
    ...asserts,
    '\nselect * from finish();\nrollback;\n',
  ].join('\n')
}

export function readCases(): BookingCase[] {
  const { cases } = JSON.parse(readFileSync(CASES_FILE, 'utf8')) as { cases: BookingCase[] }
  return cases
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(SQL_FILE, generateBookingCasesSql(readCases()))
  console.log(`escrito ${fileURLToPath(SQL_FILE)}`)
}
