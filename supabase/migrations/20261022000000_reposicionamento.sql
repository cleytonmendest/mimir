-- Reposicionamento do produto: de "rota do repositor" para "Agenda de Degustações" (reserva de
-- estandes por mercado e dia, com limite). Ver docs/mvp.md e o ADR 0005.
--
-- Nada foi para produção, então não há dado a preservar: visitas, rota padrão, eventos, a
-- sincronização offline e o estado dos aparelhos saem inteiros. Ficam o perfil, os mercados, o log de
-- auditoria e o fuso da empresa (company_date).
--
-- Regra de ouro: este arquivo, depois de aplicado em qualquer ambiente, NUNCA é editado.

------------------------------------------------------------------------------
-- O que sai
------------------------------------------------------------------------------
drop function public.sync_visit_events_v1(uuid, text, jsonb);
drop function public.apply_visit_event(uuid, uuid, text, jsonb);
drop function public.sync_result(text, uuid, text, text, text, boolean);
drop function public.version_parts(text);
drop function public.safe_timestamptz(text);
drop function public.safe_int(text);
drop function public.safe_uuid(text);

drop table public.device_status;
drop table public.app_config;
drop table public.visit_events;
drop table public.visits;
drop table public.standard_route;

drop function public.guard_visit_update();
drop type public.visit_status;
drop type public.visit_origin;

------------------------------------------------------------------------------
-- Papéis: admin (o dono, que administra) e supplier (o fornecedor, que reserva)
------------------------------------------------------------------------------
-- As policies que dependem de is_leader() saem antes da função. As de mercados e de perfis voltam
-- logo abaixo, com a regra nova.
drop policy profiles_select on public.profiles;
drop policy profiles_update_leader on public.profiles;
drop policy markets_insert on public.markets;
drop policy markets_update on public.markets;
drop policy audit_log_select_leader on public.audit_log;
drop function public.is_leader();

alter type public.user_role rename to user_role_old;
create type public.user_role as enum ('admin', 'supplier');

alter table public.profiles alter column role drop default;
alter table public.profiles
  alter column role type public.user_role
  using (case role::text when 'leader' then 'admin' else 'supplier' end)::public.user_role;
-- Menor privilégio: quem não foi promovido explicitamente é fornecedor.
alter table public.profiles alter column role set default 'supplier';

alter table public.audit_log
  alter column actor_role type public.user_role
  using (case actor_role::text when 'leader' then 'admin' when 'repositor' then 'supplier' end)::public.user_role;

drop type public.user_role_old;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- O papel nunca vem do cliente: toda conta nova nasce fornecedora. Só um admin promove alguém.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, role, full_name)
  values (new.id, 'supplier', coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

------------------------------------------------------------------------------
-- Quem lê e quem escreve
------------------------------------------------------------------------------
-- profiles: cada um vê o próprio; o admin vê e altera todos (inclusive o papel).
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy profiles_update_admin on public.profiles for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- markets: qualquer logado lê (o fornecedor escolhe onde reservar); só o admin cadastra e edita.
-- Ninguém apaga (arquiva).
create policy markets_insert_admin on public.markets for insert to authenticated
  with check ((select public.is_admin()));
create policy markets_update_admin on public.markets for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- audit_log: só o admin lê. Ninguém escreve pela API: só os triggers.
create policy audit_log_select_admin on public.audit_log for select to authenticated
  using ((select public.is_admin()));
