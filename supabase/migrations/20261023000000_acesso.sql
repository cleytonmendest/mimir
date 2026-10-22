-- Acesso (Bloco 5 do plano, docs/mvp.md): quem pode entrar e como um fornecedor ganha conta.
--
-- O administrador cadastra os fornecedores (Edge Function admin-create-supplier). Além disso existe
-- uma página pública /cadastro, e o administrador escolhe o modo: fechado (padrão), com código de
-- convite ou livre. Conta desativada perde o acesso na hora, em todas as camadas: o RLS e as funções
-- de reserva olham deactivated_at. O histórico (reservas, auditoria) fica.
--
-- Regra de ouro: este arquivo, depois de aplicado em qualquer ambiente, NUNCA é editado.

------------------------------------------------------------------------------
-- Perfil: e-mail e desativação
------------------------------------------------------------------------------
alter table public.profiles
  add column email text,
  add column deactivated_at timestamptz;

comment on column public.profiles.email is
  'Cópia do e-mail do login, só para o administrador listar fornecedores (auth.users não é legível pela API). Não se altera por aqui.';
comment on column public.profiles.deactivated_at is
  'Quando o acesso foi cortado. Conta desativada não reserva, não cancela e não lê mercados nem reservas; o histórico fica.';

update public.profiles p set email = u.email from auth.users u where u.id = p.id;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, role, full_name, email)
  values (new.id, 'supplier', coalesce(new.raw_user_meta_data ->> 'full_name', ''), new.email);
  return new;
end;
$$;

-- Quem está logado e com a conta ativa. Todas as leituras de fornecedor passam por aqui.
create function public.is_active_user() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.deactivated_at is null
  );
$$;

-- Administrador desativado deixa de administrar.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin' and p.deactivated_at is null
  );
$$;

revoke all on function public.is_active_user() from public, anon;
grant execute on function public.is_active_user() to authenticated;

-- Ninguém altera o próprio papel nem a própria desativação pela API (o administrador não se
-- tranca para fora nem se rebaixa sem querer), e o e-mail do perfil só muda junto com o login.
-- Sem usuário logado (migrations, chave de serviço, scripts) não há restrição aqui.
--
-- Não existe um gatilho de "sempre resta um administrador": quem altera outro perfil é, por força
-- da policy, um administrador ativo e diferente do alvo. Sobra sempre pelo menos ele.
create function public.guard_profile_change() returns trigger
language plpgsql set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null then
    return new;
  end if;
  if new.email is distinct from old.email then
    raise exception 'profile_email_is_managed' using errcode = '42501';
  end if;
  if new.id = actor
     and (new.role is distinct from old.role or new.deactivated_at is distinct from old.deactivated_at) then
    raise exception 'profile_own_access_locked' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_change();

create trigger profiles_audit after insert or update or delete on public.profiles
  for each row execute function public.audit_row_change();

------------------------------------------------------------------------------
-- Conta desativada não lê nem reserva
------------------------------------------------------------------------------
drop policy markets_select on public.markets;
create policy markets_select on public.markets for select to authenticated
  using ((select public.is_active_user()));

drop policy closed_days_select on public.closed_days;
create policy closed_days_select on public.closed_days for select to authenticated
  using ((select public.is_active_user()));

drop policy bookings_select on public.bookings;
create policy bookings_select on public.bookings for select to authenticated
  using (
    (supplier_id = (select auth.uid()) and (select public.is_active_user()))
    or (select public.is_admin())
  );

-- As três funções de reserva ganham a conferência da conta ativa. Fora isso, são as mesmas de
-- 20261022120000_reservas.sql (a ordem das conferências continua a de src/domain/booking.ts).
create or replace function public.book_slot_v1(p_market uuid, p_day date) returns jsonb
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
  -- "for share": quem desativa a conta (set_supplier_active_v1) segura a linha do perfil; uma reserva
  -- que estava a caminho espera e, ao ler de novo, já encontra a conta desativada.
  select p.role into actor_role
    from public.profiles p
    where p.id = actor and p.deactivated_at is null
    for share;
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

create or replace function public.cancel_booking_v1(p_booking uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_role public.user_role;
  b public.bookings%rowtype;
  today date := public.company_date(now());
  reason text := nullif(btrim(p_reason), '');
begin
  select p.role into actor_role
    from public.profiles p
    where p.id = actor and p.deactivated_at is null;
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

create or replace function public.market_availability_v1(p_market uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  mk public.markets%rowtype;
  today date := public.company_date(now());
  days jsonb;
begin
  if actor is null
     or not exists (select 1 from public.profiles p where p.id = actor and p.deactivated_at is null) then
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

-- Desativar ou reativar um fornecedor (só o administrador). Desativar também cancela as reservas
-- dele de hoje em diante, para as vagas voltarem a quem quer usar. Repetir a chamada é seguro.
-- Devolve {ok: true, active, cancelled} ou {ok: false, code: FORBIDDEN | NOT_FOUND}.
create function public.set_supplier_active_v1(p_supplier uuid, p_active boolean) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target public.profiles%rowtype;
  today date := public.company_date(now());
  cancelled integer := 0;
begin
  if actor is null or not (select public.is_admin()) then
    return public.booking_refusal('FORBIDDEN');
  end if;

  select * into target from public.profiles p where p.id = p_supplier for update;
  if not found or target.role <> 'supplier' then
    return public.booking_refusal('NOT_FOUND');
  end if;

  if p_active then
    update public.profiles set deactivated_at = null
      where id = p_supplier and deactivated_at is not null;
  else
    update public.profiles set deactivated_at = coalesce(deactivated_at, now())
      where id = p_supplier;

    with released as (
      update public.bookings
        set cancelled_at = now(), cancelled_by = actor, cancel_reason = 'Fornecedor desativado'
        where supplier_id = p_supplier and cancelled_at is null and day >= today
        returning 1
    )
    select count(*)::integer into cancelled from released;
  end if;

  return jsonb_build_object('ok', true, 'active', p_active, 'cancelled', cancelled);
end;
$$;

------------------------------------------------------------------------------
-- Cadastro pela página pública
------------------------------------------------------------------------------
-- Espelha SIGNUP_MODES em src/domain/access.ts (domain/schema-sync.test.ts confere).
create type public.signup_mode as enum ('closed', 'invite', 'open');

-- Uma linha só. Fica fora de qualquer tabela legível por todos: o código de convite é segredo do
-- administrador. A página pública só sabe o modo, e pela Edge Function signup-status.
create table public.signup_settings (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique check (singleton),
  mode public.signup_mode not null default 'closed',
  -- 8 caracteres sem 0, O, 1, I (nada que se confunda ao ditar por telefone). Guardado sem hífen.
  invite_code text check (invite_code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$'),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

insert into public.signup_settings default values;

-- Tentativas de cadastro pela página pública, para limitar abuso. Só a chave de serviço (Edge
-- Function) lê e escreve; guarda hash, nunca o IP nem o e-mail puros.
create table public.signup_attempts (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  ip_hash text not null,
  email_hash text not null,
  outcome text not null
);
create index signup_attempts_by_ip on public.signup_attempts (ip_hash, at);
create index signup_attempts_by_email on public.signup_attempts (email_hash, at);
create index signup_attempts_by_time on public.signup_attempts (at);

-- Sorteio do código: 5 bits por caractere vindos de bytes aleatórios do servidor. 256 é múltiplo
-- de 32, então não há viés. Os bytes 6 e 8 do uuid têm bits fixos e ficam de fora.
create function public.generate_invite_code() returns text
language plpgsql volatile set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  picks constant integer[] := array[0, 1, 2, 3, 4, 5, 10, 11];
  code text := '';
  i integer;
begin
  foreach i in array picks loop
    code := code || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return code;
end;
$$;

-- Muda o modo. Ao abrir o modo com código pela primeira vez, já cria o código.
-- Devolve {ok: true, mode, invite_code} ou {ok: false, code: FORBIDDEN}.
create function public.set_signup_mode_v1(p_mode public.signup_mode) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  result public.signup_settings%rowtype;
begin
  if actor is null or not (select public.is_admin()) then
    return public.booking_refusal('FORBIDDEN');
  end if;

  update public.signup_settings
    set mode = p_mode,
        invite_code = case
          when p_mode = 'invite' and invite_code is null then public.generate_invite_code()
          else invite_code
        end,
        updated_at = now(),
        updated_by = actor
    where singleton
    returning * into result;

  return jsonb_build_object('ok', true, 'mode', result.mode, 'invite_code', result.invite_code);
end;
$$;

-- Gera outro código; o anterior deixa de valer. As contas já criadas continuam.
create function public.regenerate_invite_code_v1() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  result public.signup_settings%rowtype;
begin
  if actor is null or not (select public.is_admin()) then
    return public.booking_refusal('FORBIDDEN');
  end if;

  update public.signup_settings
    set invite_code = public.generate_invite_code(), updated_at = now(), updated_by = actor
    where singleton
    returning * into result;

  return jsonb_build_object('ok', true, 'mode', result.mode, 'invite_code', result.invite_code);
end;
$$;

create trigger signup_settings_audit after insert or update or delete on public.signup_settings
  for each row execute function public.audit_row_change();

------------------------------------------------------------------------------
-- Privilégios e RLS
------------------------------------------------------------------------------
revoke all on public.signup_settings, public.signup_attempts from anon, authenticated;
grant select on public.signup_settings to authenticated;

revoke all on function
  public.guard_profile_change(), public.generate_invite_code(),
  public.set_supplier_active_v1(uuid, boolean),
  public.set_signup_mode_v1(public.signup_mode), public.regenerate_invite_code_v1()
  from public, anon, authenticated;
grant execute on function
  public.set_supplier_active_v1(uuid, boolean),
  public.set_signup_mode_v1(public.signup_mode), public.regenerate_invite_code_v1()
  to authenticated;

alter table public.signup_settings enable row level security;
alter table public.signup_attempts enable row level security;

-- signup_settings: só o administrador lê (e muda pelas funções acima). signup_attempts: sem
-- policy nenhuma, ou seja, fechada para a API; só a chave de serviço entra.
create policy signup_settings_select_admin on public.signup_settings for select to authenticated
  using ((select public.is_admin()));
