-- Sincronização dos eventos de campo (marco 1, fatia 1.2 do plano em docs/mvp.md; ADR 0001).
--
-- O aparelho do repositor guarda eventos (check-in, check-out, "não fui") e os envia quando há
-- sinal. A função sync_visit_events_v1 aplica cada evento por uma tabela de transição, idempotente
-- pelo client_event_id, e grava o resultado (aplicado ou recusado, e por quê) junto do evento.
-- O servidor vence: se a visita mudou, o evento volta recusado e a tela explica.
--
-- As regras da função são as de src/domain (status.ts, sync.ts). Os casos de
-- src/domain/fixtures/visit-events.cases.json valem para os dois lados: o domínio os roda no Vitest
-- e esta função, no pgTAP (supabase/tests/database/70_sync_cases.test.sql, gerado do mesmo arquivo).
--
-- Ainda de fora (fatia 4.1): checar nas políticas e aqui que o usuário não foi desativado.

------------------------------------------------------------------------------
-- Eventos: resultado da aplicação e origem
------------------------------------------------------------------------------
alter table public.visit_events
  add column outcome text not null default 'applied',
  add column rejection_code text,
  add column device_id uuid,
  add column device_seq integer,
  add column client_version text;

-- Quem grava passa a dizer o resultado sempre (o padrão só serve para o que já existia).
alter table public.visit_events alter column outcome drop default;

alter table public.visit_events
  add constraint visit_events_outcome_known check (outcome in ('applied', 'rejected')),
  add constraint visit_events_rejection_matches_outcome
    check ((outcome = 'rejected') = (rejection_code is not null));

comment on column public.visit_events.occurred_local_date is
  'Dia da empresa no instante do evento, calculado pelo servidor (ADR 0002), nunca o do aparelho.';
comment on column public.visit_events.device_seq is
  'Número de ordem no aparelho (seq da fila local). Diagnóstico: não é único, a fila pode ser recriada.';

create index visit_events_by_visit on public.visit_events (visit_id, occurred_at);
create index visits_by_repositor on public.visits (repositor_id, visit_date);

------------------------------------------------------------------------------
-- Via única: o aparelho não grava evento direto, só pela função.
------------------------------------------------------------------------------
drop policy visit_events_insert on public.visit_events;
revoke insert on public.visit_events from authenticated;

------------------------------------------------------------------------------
-- Auditoria: de onde veio a mudança, e no update só a diferença (ADR 0004)
------------------------------------------------------------------------------
alter table public.audit_log
  add column source text not null default 'app',
  add constraint audit_log_source_known check (source in ('app', 'sync', 'system'));

comment on column public.audit_log.source is
  'app: escrita direta pela API. sync: função de sincronização do aparelho. system: job do servidor. Rótulo, não segurança: quem agiu é actor_id.';

create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  old_json jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  new_json jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  diff jsonb;
  actor uuid := (select auth.uid());
  origin text := coalesce(nullif(current_setting('app.source', true), ''), 'app');
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

  insert into public.audit_log
    (actor_id, actor_role, table_name, row_id, action, old_row, new_row, changes, source)
  values (
    actor,
    (select p.role from public.profiles p where p.id = actor),
    tg_table_name,
    coalesce(new_json ->> 'id', old_json ->> 'id')::uuid,
    lower(tg_op),
    -- No update a diferença (changes) já diz o que mudou; a linha inteira só em insert e delete.
    case when tg_op = 'UPDATE' then null else old_json end,
    case when tg_op = 'UPDATE' then null else new_json end,
    diff,
    case when origin in ('sync', 'system') then origin else 'app' end
  );

  return coalesce(new, old);
end;
$$;

------------------------------------------------------------------------------
-- Configuração do app e estado dos aparelhos
------------------------------------------------------------------------------
-- Uma linha só. Subir min_client_version faz a sincronização responder "atualize o app" a versões
-- mais antigas, sem apagar a fila do aparelho.
create table public.app_config (
  id boolean primary key default true check (id),
  min_client_version text not null default '0.0.0',
  updated_at timestamptz not null default now()
);
insert into public.app_config default values;

-- Último contato de cada aparelho (o líder vê quem está sem sincronizar). Um aparelho pode ter mais
-- de um usuário, cada um com a sua fila.
create table public.device_status (
  device_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  client_version text not null,
  first_seen_at timestamptz not null default now(),
  last_sync_at timestamptz not null default now(),
  primary key (device_id, user_id)
);

revoke all on public.app_config, public.device_status from anon, authenticated;
grant select on public.app_config, public.device_status to authenticated;

alter table public.app_config enable row level security;
alter table public.device_status enable row level security;

create policy app_config_select on public.app_config for select to authenticated using (true);
create policy device_status_select on public.device_status for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_leader()));

------------------------------------------------------------------------------
-- Leitura segura de texto vindo do aparelho: lixo vira null em vez de derrubar o envio todo.
------------------------------------------------------------------------------
create function public.safe_uuid(p text) returns uuid
language plpgsql immutable set search_path = ''
as $$
begin
  return p::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

create function public.safe_int(p text) returns integer
language plpgsql immutable set search_path = ''
as $$
begin
  return p::integer;
exception when invalid_text_representation or numeric_value_out_of_range then
  return null;
end;
$$;

-- Só instante ISO 8601 completo, com fuso: o Postgres aceitaria também 'now', 'infinity', 'today'...
create function public.safe_timestamptz(p text) returns timestamptz
language plpgsql stable set search_path = ''
as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
    return null;
  end if;
  return p::timestamptz;
exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
  return null;
end;
$$;

-- "0.3.1+a1b2c3d" -> {0,3,1}. Versão mal formada é erro: o app só manda a que ele mesmo montou.
create function public.version_parts(v text) returns integer[]
language sql immutable set search_path = ''
as $$
  select string_to_array(split_part(v, '+', 1), '.')::integer[];
$$;

create function public.sync_result(
  p_event_id text,
  p_visit_id uuid,
  p_status text,
  p_code text,
  p_visit_status text default null,
  p_duplicate boolean default false
) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'client_event_id', p_event_id,
    'visit_id', p_visit_id,
    'status', p_status,
    'code', p_code,
    'visit_status', p_visit_status,
    'duplicate', p_duplicate
  );
$$;

------------------------------------------------------------------------------
-- Um evento: lê, confere, aplica e guarda o resultado. Só a sync_visit_events_v1 chama.
------------------------------------------------------------------------------
create function public.apply_visit_event(
  p_caller uuid,
  p_device_id uuid,
  p_client_version text,
  p_event jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  event_text text := p_event ->> 'client_event_id';
  event_id uuid := public.safe_uuid(p_event ->> 'client_event_id');
  visit_id uuid := public.safe_uuid(p_event ->> 'visit_id');
  seq integer := public.safe_int(p_event ->> 'seq');
  kind text := p_event ->> 'type';
  occurred timestamptz := public.safe_timestamptz(p_event ->> 'occurred_at');
  -- Texto muito longo é cortado, não recusado: o check-out nunca se perde por causa da observação.
  event_note text := left(p_event ->> 'note', 4000);
  event_reason text := left(
    regexp_replace(coalesce(p_event ->> 'reason', ''), '^\s+|\s+$', '', 'g'), 1000
  );
  caused_by_text text := p_event ->> 'caused_by';
  caused_by uuid := public.safe_uuid(p_event ->> 'caused_by');
  current_visit public.visits;
  stored public.visit_events;
  event_day date;
  code text;
begin
  -- Dado que nem dá para guardar: não vira linha em visit_events, só volta recusado.
  if event_id is null or visit_id is null or seq is null or occurred is null
     or kind is null or kind not in ('checkIn', 'checkOut', 'markNotDone')
     or (caused_by_text is not null and caused_by is null) then
    return public.sync_result(event_text, visit_id, 'rejected', 'INVALID_DATA');
  end if;

  select * into current_visit from public.visits v where v.id = visit_id;
  if not found then
    return public.sync_result(event_text, visit_id, 'rejected', 'VISIT_NOT_FOUND');
  end if;
  if current_visit.repositor_id <> p_caller then
    -- Não grava nada na visita dos outros, nem a recusa.
    return public.sync_result(event_text, visit_id, 'rejected', 'FORBIDDEN');
  end if;

  -- Reenvio: devolve o resultado que já foi decidido, sem aplicar de novo.
  select * into stored from public.visit_events e where e.client_event_id = event_id;
  if found then
    if stored.actor_id <> p_caller or stored.visit_id <> visit_id or stored.type <> kind then
      return public.sync_result(event_text, visit_id, 'rejected', 'ID_CONFLICT');
    end if;
    return public.sync_result(
      event_text, visit_id, stored.outcome, stored.rejection_code, current_visit.status::text, true
    );
  end if;

  event_day := public.company_date(occurred);

  -- Mesma ordem de checagens de evaluateTransition (src/domain/status.ts).
  code := case
    when occurred > now() + interval '10 minutes' then 'CLOCK_INVALID'
    when kind = 'checkIn' then
      case
        when current_visit.status <> 'planned' then 'INVALID_TRANSITION'
        when current_visit.visit_date > event_day then 'VISIT_IN_FUTURE'
        when current_visit.visit_date < event_day then 'VISIT_IN_PAST'
      end
    when kind = 'checkOut' then
      case
        when current_visit.status <> 'in_progress' then 'INVALID_TRANSITION'
        when current_visit.check_in_at is null or occurred < current_visit.check_in_at
          then 'CHECKOUT_BEFORE_CHECKIN'
      end
    else
      case
        when current_visit.status not in ('planned', 'in_progress') then 'INVALID_TRANSITION'
        when current_visit.visit_date > event_day then 'VISIT_IN_FUTURE'
        when event_reason = '' then 'REASON_REQUIRED'
      end
  end;

  if code is null then
    perform set_config('app.source', 'sync', true);
    update public.visits v set
      status = (case kind
        when 'checkIn' then 'in_progress'
        when 'checkOut' then 'done'
        else 'not_done'
      end)::public.visit_status,
      check_in_at = case when kind = 'checkIn' then occurred else v.check_in_at end,
      check_out_at = case when kind = 'checkOut' then occurred else v.check_out_at end,
      note = case when kind = 'checkOut' then coalesce(event_note, v.note) else v.note end,
      skip_reason = case when kind = 'markNotDone' then event_reason else v.skip_reason end
    where v.id = visit_id
    returning * into current_visit;
  end if;

  -- Se outro envio gravou este id em outra visita entre a leitura e agora, o unique_violation sobe
  -- e a sync_visit_events_v1 o devolve como ID_CONFLICT, desfazendo só este evento.
  insert into public.visit_events (
    client_event_id, visit_id, actor_id, type, occurred_at, occurred_local_date, payload,
    outcome, rejection_code, device_id, device_seq, client_version
  ) values (
    event_id, visit_id, p_caller, kind, occurred, event_day,
    jsonb_strip_nulls(jsonb_build_object(
      'note', event_note,
      'reason', nullif(event_reason, ''),
      'caused_by', caused_by
    )),
    case when code is null then 'applied' else 'rejected' end, code,
    p_device_id, seq, left(p_client_version, 64)
  );

  return public.sync_result(
    event_text, visit_id, case when code is null then 'applied' else 'rejected' end, code,
    current_visit.status::text
  );
end;
$$;

------------------------------------------------------------------------------
-- A função que o aparelho chama.
--   p_events: lista (até 50) de { client_event_id, seq, visit_id, type, occurred_at, note?, reason?,
--   caused_by? }. Aplica em ordem de seq. Devolve { server_now, results[], visits[] }, ou
--   { upgrade_required, min_client_version, server_now } se o app for velho demais.
-- Nome com versão: a assinatura nunca muda; uma v2 convive com a v1.
------------------------------------------------------------------------------
create function public.sync_visit_events_v1(
  p_device_id uuid,
  p_client_version text,
  p_events jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  min_version text;
  item record;
  results jsonb := '[]'::jsonb;
  visit_ids uuid[];
begin
  if caller is null then
    raise exception 'sessão ausente' using errcode = '42501';
  end if;
  if p_device_id is null or p_client_version is null then
    raise exception 'device_id e client_version são obrigatórios' using errcode = '22023';
  end if;
  if jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'events precisa ser uma lista' using errcode = '22023';
  end if;
  if jsonb_array_length(p_events) > 50 then
    raise exception 'no máximo 50 eventos por envio' using errcode = '54000';
  end if;

  select c.min_client_version into min_version from public.app_config c;
  if public.version_parts(p_client_version) < public.version_parts(min_version) then
    return jsonb_build_object(
      'upgrade_required', true,
      'min_client_version', min_version,
      'server_now', clock_timestamp()
    );
  end if;

  -- Trava as visitas do repositor tocadas pelo lote, em ordem de id: dois envios simultâneos (o
  -- reenvio de uma resposta perdida, outro aparelho) esperam um pelo outro em vez de se cruzar.
  perform 1
    from public.visits v
   where v.repositor_id = caller
     and v.id in (select public.safe_uuid(e ->> 'visit_id') from jsonb_array_elements(p_events) as e)
   order by v.id
     for update;

  for item in
    select e.value as event
      from jsonb_array_elements(p_events) with ordinality as e(value, ordinality)
     order by public.safe_int(e.value ->> 'seq'), e.ordinality
  loop
    begin
      results := results || jsonb_build_array(
        public.apply_visit_event(caller, p_device_id, p_client_version, item.event)
      );
    exception
      -- Um evento que o banco recusa (constraint, regra do guard_visit_update) não derruba o lote.
      when check_violation or not_null_violation or insufficient_privilege or unique_violation then
        results := results || jsonb_build_array(public.sync_result(
          item.event ->> 'client_event_id',
          public.safe_uuid(item.event ->> 'visit_id'),
          'rejected',
          case sqlstate
            when '42501' then 'FORBIDDEN'
            when '23505' then 'ID_CONFLICT'
            else 'INVALID_DATA'
          end
        ));
    end;
  end loop;

  insert into public.device_status (device_id, user_id, client_version, last_sync_at)
  values (p_device_id, caller, left(p_client_version, 64), now())
  on conflict (device_id, user_id) do update
    set client_version = excluded.client_version, last_sync_at = excluded.last_sync_at;

  select coalesce(array_agg(distinct public.safe_uuid(r ->> 'visit_id')), '{}')
    into visit_ids
    from jsonb_array_elements(results) as r
   where public.safe_uuid(r ->> 'visit_id') is not null;

  return jsonb_build_object(
    'server_now', clock_timestamp(),
    'results', results,
    'visits', coalesce(
      (select jsonb_agg(to_jsonb(v) order by v.visit_date, v.position, v.id)
         from public.visits v
        where v.repositor_id = caller and v.id = any (visit_ids)),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function
  public.safe_uuid(text), public.safe_int(text), public.safe_timestamptz(text),
  public.version_parts(text), public.sync_result(text, uuid, text, text, text, boolean),
  public.apply_visit_event(uuid, uuid, text, jsonb),
  public.sync_visit_events_v1(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_visit_events_v1(uuid, text, jsonb) to authenticated;
