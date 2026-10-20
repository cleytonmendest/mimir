-- Rota do repositor: schema inicial.
-- Regra de ouro: este arquivo, depois de aplicado em qualquer ambiente, NUNCA é editado.
-- Mudança de schema = nova migration. O CI barra alteração em migration existente.

------------------------------------------------------------------------------
-- Tipos (espelham src/domain/types.ts; supabase-sync.test.ts garante a igualdade)
------------------------------------------------------------------------------
create type public.user_role as enum ('repositor', 'leader');
create type public.visit_status as enum ('planned', 'in_progress', 'done', 'not_done', 'cancelled');
create type public.visit_origin as enum ('standard', 'exception', 'carryover');

------------------------------------------------------------------------------
-- Tabelas
------------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'repositor',
  full_name text not null default '',
  created_at timestamptz not null default now()
);

create table public.markets (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  address text,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.standard_route (
  id uuid primary key default gen_random_uuid(),
  repositor_id uuid not null references public.profiles (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  market_id uuid not null references public.markets (id) on delete restrict,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (repositor_id, weekday, market_id)
);

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  repositor_id uuid not null references public.profiles (id) on delete restrict,
  market_id uuid not null references public.markets (id) on delete restrict,
  visit_date date not null,
  position integer not null default 0,
  status public.visit_status not null default 'planned',
  origin public.visit_origin not null default 'standard',
  carried_from_date date,
  check_in_at timestamptz,
  check_out_at timestamptz,
  note text,
  skip_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Um repositor visita um mercado no máximo uma vez por dia.
  constraint visits_one_per_market_per_day unique (repositor_id, market_id, visit_date),
  constraint visits_in_progress_has_check_in
    check (status <> 'in_progress' or check_in_at is not null),
  constraint visits_done_has_times
    check (status <> 'done' or (check_in_at is not null and check_out_at is not null)),
  constraint visits_check_out_after_check_in
    check (check_out_at is null or (check_in_at is not null and check_out_at >= check_in_at)),
  constraint visits_not_done_has_reason
    check (status <> 'not_done' or coalesce(btrim(skip_reason), '') <> ''),
  constraint visits_carryover_has_origin_date
    check ((origin = 'carryover') = (carried_from_date is not null))
);

create index visits_by_date on public.visits (visit_date, repositor_id);

-- Eventos registrados no celular (talvez offline). client_event_id único = reenvio inofensivo.
create table public.visit_events (
  id uuid primary key default gen_random_uuid(),
  client_event_id uuid not null unique,
  visit_id uuid not null references public.visits (id) on delete cascade,
  actor_id uuid not null references public.profiles (id),
  type text not null check (type in ('checkIn', 'checkOut', 'markNotDone')),
  occurred_at timestamptz not null,
  occurred_local_date date not null,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_role public.user_role,
  table_name text not null,
  row_id uuid not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  old_row jsonb,
  new_row jsonb,
  changes jsonb
);

create index audit_log_by_row on public.audit_log (table_name, row_id, at);

------------------------------------------------------------------------------
-- Funções
------------------------------------------------------------------------------
create function public.is_leader() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'leader'
  );
$$;

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Registra quem mudou o quê, para qualquer usuário (líder ou repositor).
create function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  old_json jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  new_json jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  diff jsonb;
  actor uuid := (select auth.uid());
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, jsonb_build_object('from', old_json -> n.key, 'to', n.value))
      into diff
      from jsonb_each(new_json) as n
      where n.key <> 'updated_at' and (old_json -> n.key) is distinct from n.value;

    -- Atualização que não mudou nada não gera log.
    if diff is null then
      return new;
    end if;
  end if;

  insert into public.audit_log (actor_id, actor_role, table_name, row_id, action, old_row, new_row, changes)
  values (
    actor,
    (select p.role from public.profiles p where p.id = actor),
    tg_table_name,
    coalesce(new_json ->> 'id', old_json ->> 'id')::uuid,
    lower(tg_op),
    old_json,
    new_json,
    diff
  );

  return coalesce(new, old);
end;
$$;

-- O que o repositor NÃO pode fazer numa visita, mesmo sendo dele (RLS não restringe coluna).
-- Espelha src/domain/status.ts e permissions.ts.
create function public.guard_visit_update() returns trigger
language plpgsql set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  -- Sem usuário logado (migrations, service role) ou líder: sem restrição aqui.
  if actor is null or public.is_leader() then
    return new;
  end if;

  if new.repositor_id is distinct from old.repositor_id then
    raise exception 'repositor_id não pode ser alterado' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'planned' and new.status in ('in_progress', 'not_done', 'cancelled'))
      or (old.status = 'in_progress' and new.status in ('done', 'not_done'))
      or (old.status = 'cancelled' and new.status = 'planned')
    ) then
      raise exception 'transição % -> % só pode ser feita pelo líder', old.status, new.status
        using errcode = '42501';
    end if;
  elsif old.status in ('done', 'not_done') then
    raise exception 'visita encerrada só pode ser alterada pelo líder' using errcode = '42501';
  end if;

  return new;
end;
$$;

------------------------------------------------------------------------------
-- Triggers
------------------------------------------------------------------------------
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create trigger visits_touch before update on public.visits
  for each row execute function public.touch_updated_at();

create trigger visits_guard before update on public.visits
  for each row execute function public.guard_visit_update();

create trigger visits_audit after insert or update or delete on public.visits
  for each row execute function public.audit_row_change();

create trigger standard_route_audit after insert or update or delete on public.standard_route
  for each row execute function public.audit_row_change();

create trigger markets_audit after insert or update or delete on public.markets
  for each row execute function public.audit_row_change();

------------------------------------------------------------------------------
-- Privilégios: ninguém anônimo; logado só recebe o mínimo.
------------------------------------------------------------------------------
revoke all on public.profiles, public.markets, public.standard_route, public.visits,
  public.visit_events, public.audit_log from anon, authenticated;
revoke all on sequence public.audit_log_id_seq from anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update on public.markets to authenticated;
grant select, insert, update, delete on public.standard_route to authenticated;
grant select, insert, update on public.visits to authenticated; -- sem delete: histórico não se apaga
grant select, insert on public.visit_events to authenticated;
grant select on public.audit_log to authenticated;

revoke all on function public.is_leader() from public, anon;
grant execute on function public.is_leader() to authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.touch_updated_at() from public, anon, authenticated;
revoke all on function public.audit_row_change() from public, anon, authenticated;
revoke all on function public.guard_visit_update() from public, anon, authenticated;

------------------------------------------------------------------------------
-- RLS
------------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.markets enable row level security;
alter table public.standard_route enable row level security;
alter table public.visits enable row level security;
alter table public.visit_events enable row level security;
alter table public.audit_log enable row level security;

-- profiles: cada um vê o próprio; líder vê e altera todos (inclusive o papel).
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_leader()));
create policy profiles_update_leader on public.profiles for update to authenticated
  using ((select public.is_leader())) with check ((select public.is_leader()));

-- markets: catálogo compartilhado. Qualquer logado cadastra e edita; ninguém apaga (arquiva).
create policy markets_select on public.markets for select to authenticated using (true);
create policy markets_insert on public.markets for insert to authenticated with check (true);
create policy markets_update on public.markets for update to authenticated using (true) with check (true);

-- standard_route: o repositor cuida da própria rota; líder cuida de todas.
create policy standard_route_all on public.standard_route for all to authenticated
  using (repositor_id = (select auth.uid()) or (select public.is_leader()))
  with check (repositor_id = (select auth.uid()) or (select public.is_leader()));

-- visits
create policy visits_select on public.visits for select to authenticated
  using (repositor_id = (select auth.uid()) or (select public.is_leader()));
create policy visits_insert on public.visits for insert to authenticated
  with check (
    (select public.is_leader())
    or (repositor_id = (select auth.uid()) and status = 'planned')
  );
create policy visits_update on public.visits for update to authenticated
  using (repositor_id = (select auth.uid()) or (select public.is_leader()))
  with check (repositor_id = (select auth.uid()) or (select public.is_leader()));

-- visit_events: só enxerga/grava quem enxerga a visita; ninguém altera depois.
create policy visit_events_select on public.visit_events for select to authenticated
  using (exists (select 1 from public.visits v where v.id = visit_id));
create policy visit_events_insert on public.visit_events for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and exists (select 1 from public.visits v where v.id = visit_id)
  );

-- audit_log: só o líder lê. Ninguém escreve pela API: só os triggers.
create policy audit_log_select_leader on public.audit_log for select to authenticated
  using ((select public.is_leader()));
