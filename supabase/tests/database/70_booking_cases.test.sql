-- GERADO por scripts/gen-booking-cases.ts a partir de src/domain/fixtures/booking.cases.json.
-- Não edite: mude o caso no JSON e rode "npm run db:gen-cases".
-- Cada caso monta um mercado, um dia e as reservas, chama book_slot_v1 como o fornecedor (ou o
-- administrador) e confere a decisão. É o mesmo contrato que o domínio cumpre em
-- src/domain/booking.cases.test.ts.

begin;
select plan(24);

create schema tests;

create function tests.login_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;

-- Fornecedores 1..21, nascidos como supplier, e um administrador.
do $$
begin
  for n in 1..21 loop
    insert into auth.users (id, email)
      values (('00000000-0000-0000-0001-' || lpad(n::text, 12, '0'))::uuid, 'fornecedor' || n || '@test.dev');
  end loop;
  insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c1', 'admin@test.dev');
  update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000c1';
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

  actor := case when p_role = 'admin' then '00000000-0000-0000-0000-0000000000c1'::uuid
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

select ok(
  tests.run_case('supplier', 1, false, false, 3, 0, false)
    @> $q${"ok":true,"already_booked":false}$q$::jsonb,
  $q$dia livre: reserva$q$
);

select ok(
  tests.run_case('supplier', 5, false, false, 3, 2, false)
    @> $q${"ok":true,"already_booked":false}$q$::jsonb,
  $q$a última vaga ainda é reservada$q$
);

select ok(
  tests.run_case('supplier', 5, false, false, 3, 3, false)
    @> $q${"ok":false,"code":"FULL"}$q$::jsonb,
  $q$dia lotado: recusa com FULL$q$
);

select ok(
  tests.run_case('supplier', 2, false, false, 1, 1, false)
    @> $q${"ok":false,"code":"FULL"}$q$::jsonb,
  $q$limite 1 com 1 reserva: lotado$q$
);

select ok(
  tests.run_case('supplier', 2, false, false, 2, 3, false)
    @> $q${"ok":false,"code":"FULL"}$q$::jsonb,
  $q$limite reduzido abaixo das reservas existentes: lotado$q$
);

select ok(
  tests.run_case('supplier', 3, false, false, 20, 19, false)
    @> $q${"ok":true,"already_booked":false}$q$::jsonb,
  $q$limite 20 com 19 reservas: ainda cabe$q$
);

select ok(
  tests.run_case('supplier', 3, false, false, 20, 20, false)
    @> $q${"ok":false,"code":"FULL"}$q$::jsonb,
  $q$limite 20 com 20 reservas: lotado$q$
);

select ok(
  tests.run_case('supplier', 4, false, false, 3, 1, true)
    @> $q${"ok":true,"already_booked":true}$q$::jsonb,
  $q$repetir a própria reserva é sucesso, sem reservar de novo$q$
);

select ok(
  tests.run_case('supplier', 4, false, false, 3, 3, true)
    @> $q${"ok":true,"already_booked":true}$q$::jsonb,
  $q$repetir a própria reserva num dia lotado também é sucesso$q$
);

select ok(
  tests.run_case('supplier', 6, false, true, 3, 0, false)
    @> $q${"ok":false,"code":"CLOSED"}$q$::jsonb,
  $q$dia fechado: recusa com CLOSED$q$
);

select ok(
  tests.run_case('supplier', 6, false, true, 3, 3, false)
    @> $q${"ok":false,"code":"CLOSED"}$q$::jsonb,
  $q$dia fechado e lotado: CLOSED vem antes de FULL$q$
);

select ok(
  tests.run_case('supplier', 6, false, true, 3, 1, true)
    @> $q${"ok":false,"code":"CLOSED"}$q$::jsonb,
  $q$a reserva própria não vale num dia que foi fechado depois$q$
);

select ok(
  tests.run_case('supplier', 7, true, false, 3, 0, false)
    @> $q${"ok":false,"code":"MARKET_INACTIVE"}$q$::jsonb,
  $q$mercado arquivado: MARKET_INACTIVE$q$
);

select ok(
  tests.run_case('supplier', 7, true, true, 3, 0, false)
    @> $q${"ok":false,"code":"MARKET_INACTIVE"}$q$::jsonb,
  $q$mercado arquivado e dia fechado: MARKET_INACTIVE vem antes$q$
);

select ok(
  tests.run_case('supplier', 7, true, false, 3, 1, true)
    @> $q${"ok":false,"code":"MARKET_INACTIVE"}$q$::jsonb,
  $q$mercado arquivado com reserva própria: MARKET_INACTIVE$q$
);

select ok(
  tests.run_case('supplier', 0, false, false, 3, 0, false)
    @> $q${"ok":false,"code":"OUT_OF_WINDOW"}$q$::jsonb,
  $q$hoje não se reserva (só de amanhã em diante)$q$
);

select ok(
  tests.run_case('supplier', -1, false, false, 3, 0, false)
    @> $q${"ok":false,"code":"OUT_OF_WINDOW"}$q$::jsonb,
  $q$dia que já passou: OUT_OF_WINDOW$q$
);

select ok(
  tests.run_case('supplier', 60, false, false, 3, 0, false)
    @> $q${"ok":true,"already_booked":false}$q$::jsonb,
  $q$o último dia da janela (60) ainda reserva$q$
);

select ok(
  tests.run_case('supplier', 61, false, false, 3, 0, false)
    @> $q${"ok":false,"code":"OUT_OF_WINDOW"}$q$::jsonb,
  $q$um dia além da janela (61): OUT_OF_WINDOW$q$
);

select ok(
  tests.run_case('supplier', 61, false, true, 3, 0, false)
    @> $q${"ok":false,"code":"OUT_OF_WINDOW"}$q$::jsonb,
  $q$fora da janela e fechado: OUT_OF_WINDOW vem antes$q$
);

select ok(
  tests.run_case('supplier', -2, false, false, 3, 3, false)
    @> $q${"ok":false,"code":"OUT_OF_WINDOW"}$q$::jsonb,
  $q$fora da janela e lotado: OUT_OF_WINDOW vem antes$q$
);

select ok(
  tests.run_case('supplier', 61, false, false, 3, 1, true)
    @> $q${"ok":false,"code":"OUT_OF_WINDOW"}$q$::jsonb,
  $q$fora da janela com reserva própria: OUT_OF_WINDOW$q$
);

select ok(
  tests.run_case('admin', 5, false, false, 3, 0, false)
    @> $q${"ok":false,"code":"FORBIDDEN"}$q$::jsonb,
  $q$o administrador não reserva estande$q$
);

select ok(
  tests.run_case('admin', 0, true, true, 3, 3, false)
    @> $q${"ok":false,"code":"FORBIDDEN"}$q$::jsonb,
  $q$o administrador é barrado antes de qualquer outra regra$q$
);


select * from finish();
rollback;
