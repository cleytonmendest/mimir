-- Reserva de estande (Bloco 2 do plano, ADR 0005): limite por mercado, datas fechadas e reservas.
--
-- O limite de estandes nunca pode ser ultrapassado, nem com dois fornecedores clicando na última
-- vaga ao mesmo tempo. Três camadas: a função book_slot_v1 (trava o par mercado e dia e reavalia
-- tudo), um trigger de guarda na tabela (a mesma trava, recusa insert acima do limite) e os testes
-- de concorrência. Clientes não escrevem em bookings: só pelas funções.
--
-- Regra de ouro: este arquivo, depois de aplicado em qualquer ambiente, NUNCA é editado.

------------------------------------------------------------------------------
-- Limite por mercado e janela de reserva
------------------------------------------------------------------------------
alter table public.markets
  add column capacity integer not null default 3
  constraint markets_capacity_range check (capacity between 1 and 20);

comment on column public.markets.capacity is
  'Estandes por dia neste mercado. Reduzir não cancela reservas existentes: só as novas respeitam o limite novo.';

-- Quantos dias à frente dá para reservar, a partir de amanhã. Espelha BOOKING_WINDOW_DAYS em
-- src/domain/booking.ts (domain/schema-sync.test.ts confere).
create function public.booking_window_days() returns integer
language sql immutable set search_path = ''
as $$ select 60 $$;

------------------------------------------------------------------------------
-- Tabelas
------------------------------------------------------------------------------
-- Dia em que um mercado não aceita reservas novas (feriado, inventário). Reservas já feitas continuam.
create table public.closed_days (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets (id),
  day date not null,
  reason text,
  created_at timestamptz not null default now(),
  unique (market_id, day)
);

-- Uma reserva de estande: um fornecedor, um mercado, um dia. Cancelar não apaga: marca a linha.
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets (id),
  day date not null,
  supplier_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  cancel_reason text,
  constraint bookings_cancel_consistent check ((cancelled_at is null) = (cancelled_by is null)),
  constraint bookings_reason_only_if_cancelled check (cancel_reason is null or cancelled_at is not null)
);

-- Um fornecedor não reserva duas vezes o mesmo dia no mesmo mercado (a reserva cancelada não conta).
create unique index bookings_one_active_per_supplier
  on public.bookings (market_id, day, supplier_id) where cancelled_at is null;
-- A contagem de vagas de um dia.
create index bookings_active_by_day on public.bookings (market_id, day) where cancelled_at is null;
-- "Minhas reservas".
create index bookings_by_supplier on public.bookings (supplier_id, day) where cancelled_at is null;

------------------------------------------------------------------------------
-- Funções
------------------------------------------------------------------------------
create function public.booking_refusal(p_code text) returns jsonb
language sql immutable set search_path = ''
as $$ select jsonb_build_object('ok', false, 'code', p_code) $$;

-- A chave da trava de um par mercado e dia: duas reservas do mesmo par se enfileiram.
create function public.booking_lock_key(p_market uuid, p_day date) returns bigint
language sql immutable set search_path = ''
as $$ select hashtextextended(p_market::text || ':' || p_day::text, 0) $$;

-- Camada 2: o limite vale na tabela, não só na função. Um erro futuro em outra função, ou um insert
-- feito por um script, não passa do limite. Pega a mesma trava da função (reentrante na transação).
create function public.guard_booking_capacity() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  cap integer;
  taken integer;
begin
  -- Cancelar não ocupa vaga; reativar uma reserva cancelada conta como entrar de novo.
  if new.cancelled_at is not null then
    return new;
  end if;

  perform pg_advisory_xact_lock(public.booking_lock_key(new.market_id, new.day));

  select m.capacity into cap from public.markets m where m.id = new.market_id;
  select count(*) into taken
    from public.bookings b
    where b.market_id = new.market_id and b.day = new.day and b.cancelled_at is null and b.id <> new.id;

  if taken >= cap then
    raise exception 'booking_over_capacity'
      using errcode = '23514', detail = format('mercado %s, dia %s: %s de %s', new.market_id, new.day, taken, cap);
  end if;
  return new;
end;
$$;

-- Camada 1: reservar. Devolve {ok: true, booking_id, already_booked, booked, capacity} ou
-- {ok: false, code}. A ordem das conferências é a de evaluateBooking em src/domain/booking.ts, e
-- os casos compartilhados (fixtures/booking.cases.json) provam que as duas decidem igual.
create function public.book_slot_v1(p_market uuid, p_day date) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_role public.user_role;
  mk public.markets%rowtype;
  today date := public.company_date(now());
  existing uuid;
  taken integer;
  new_id uuid;
begin
  select p.role into actor_role from public.profiles p where p.id = actor;
  if actor is null or actor_role is distinct from 'supplier' then
    return public.booking_refusal('FORBIDDEN');
  end if;

  perform pg_advisory_xact_lock(public.booking_lock_key(p_market, p_day));

  select * into mk from public.markets m where m.id = p_market;
  if not found or mk.archived_at is not null then
    return public.booking_refusal('MARKET_INACTIVE');
  end if;

  if p_day is null or p_day <= today or p_day > today + public.booking_window_days() then
    return public.booking_refusal('OUT_OF_WINDOW');
  end if;

  if exists (select 1 from public.closed_days c where c.market_id = p_market and c.day = p_day) then
    return public.booking_refusal('CLOSED');
  end if;

  select b.id into existing
    from public.bookings b
    where b.market_id = p_market and b.day = p_day and b.supplier_id = actor and b.cancelled_at is null;
  select count(*) into taken
    from public.bookings b
    where b.market_id = p_market and b.day = p_day and b.cancelled_at is null;

  -- Repetir (clique duplo, falha de rede) é seguro: devolve a reserva que já existe.
  if existing is not null then
    return jsonb_build_object(
      'ok', true, 'already_booked', true, 'booking_id', existing, 'booked', taken, 'capacity', mk.capacity
    );
  end if;

  if taken >= mk.capacity then
    return public.booking_refusal('FULL');
  end if;

  insert into public.bookings (market_id, day, supplier_id)
  values (p_market, p_day, actor)
  returning id into new_id;

  return jsonb_build_object(
    'ok', true, 'already_booked', false, 'booking_id', new_id, 'booked', taken + 1, 'capacity', mk.capacity
  );
end;
$$;

-- Cancelar. O fornecedor só a própria reserva (a dos outros é "não encontrada", para não revelar que
-- existe); o administrador qualquer uma, com motivo. Cancelar de novo é sucesso. Reserva de dia que
-- já passou é histórico; a do próprio dia ainda se cancela.
create function public.cancel_booking_v1(p_booking uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_role public.user_role;
  b public.bookings%rowtype;
  today date := public.company_date(now());
  reason text := nullif(btrim(p_reason), '');
begin
  select p.role into actor_role from public.profiles p where p.id = actor;
  if actor is null or actor_role is null then
    return public.booking_refusal('FORBIDDEN');
  end if;

  select * into b from public.bookings x where x.id = p_booking for update;
  if not found or (actor_role = 'supplier' and b.supplier_id <> actor) then
    return public.booking_refusal('NOT_FOUND');
  end if;

  if b.cancelled_at is not null then
    return jsonb_build_object('ok', true, 'already_cancelled', true);
  end if;
  if b.day < today then
    return public.booking_refusal('PAST');
  end if;

  update public.bookings
    set cancelled_at = now(),
        cancelled_by = actor,
        cancel_reason = case when actor_role = 'admin' then left(reason, 500) else null end
    where id = b.id;

  return jsonb_build_object('ok', true, 'already_cancelled', false);
end;
$$;

-- O calendário de um mercado: só contagens, nunca nomes. O fornecedor não vê quem reservou.
create function public.market_availability_v1(p_market uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  mk public.markets%rowtype;
  today date := public.company_date(now());
  days jsonb;
begin
  if actor is null or not exists (select 1 from public.profiles p where p.id = actor) then
    return public.booking_refusal('FORBIDDEN');
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    return public.booking_refusal('INVALID_RANGE');
  end if;

  select * into mk from public.markets m where m.id = p_market;
  if not found then
    return public.booking_refusal('MARKET_NOT_FOUND');
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'day', d.day,
        'booked', coalesce(c.booked, 0),
        'closed', cd.day is not null,
        'mine', coalesce(c.mine, false)
      ) order by d.day
    ),
    '[]'::jsonb
  ) into days
  from (select p_from + i as day from generate_series(0, p_to - p_from) as i) d
  left join (
    select b.day, count(*)::integer as booked, bool_or(b.supplier_id = actor) as mine
    from public.bookings b
    where b.market_id = p_market and b.day between p_from and p_to and b.cancelled_at is null
    group by b.day
  ) c on c.day = d.day
  left join public.closed_days cd on cd.market_id = p_market and cd.day = d.day;

  return jsonb_build_object(
    'ok', true, 'today', today, 'capacity', mk.capacity, 'archived', mk.archived_at is not null, 'days', days
  );
end;
$$;

------------------------------------------------------------------------------
-- Triggers
------------------------------------------------------------------------------
create trigger bookings_guard before insert or update of cancelled_at on public.bookings
  for each row execute function public.guard_booking_capacity();

create trigger bookings_audit after insert or update or delete on public.bookings
  for each row execute function public.audit_row_change();

create trigger closed_days_audit after insert or update or delete on public.closed_days
  for each row execute function public.audit_row_change();

------------------------------------------------------------------------------
-- Privilégios: reserva só pelas funções; o resto, o mínimo.
------------------------------------------------------------------------------
revoke all on public.bookings, public.closed_days from anon, authenticated;
grant select on public.bookings to authenticated;
grant select, insert, update, delete on public.closed_days to authenticated;

revoke all on function
  public.booking_window_days(), public.booking_refusal(text), public.booking_lock_key(uuid, date),
  public.guard_booking_capacity(),
  public.book_slot_v1(uuid, date), public.cancel_booking_v1(uuid, text),
  public.market_availability_v1(uuid, date, date)
  from public, anon, authenticated;
grant execute on function
  public.book_slot_v1(uuid, date), public.cancel_booking_v1(uuid, text),
  public.market_availability_v1(uuid, date, date)
  to authenticated;

------------------------------------------------------------------------------
-- RLS
------------------------------------------------------------------------------
alter table public.bookings enable row level security;
alter table public.closed_days enable row level security;

-- bookings: o fornecedor lê só as próprias; o administrador lê todas, com os nomes. Ninguém escreve
-- direto: só book_slot_v1 e cancel_booking_v1.
create policy bookings_select on public.bookings for select to authenticated
  using (supplier_id = (select auth.uid()) or (select public.is_admin()));

-- closed_days: qualquer logado lê; só o administrador fecha e libera datas.
create policy closed_days_select on public.closed_days for select to authenticated using (true);
create policy closed_days_insert_admin on public.closed_days for insert to authenticated
  with check ((select public.is_admin()));
create policy closed_days_update_admin on public.closed_days for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy closed_days_delete_admin on public.closed_days for delete to authenticated
  using ((select public.is_admin()));
