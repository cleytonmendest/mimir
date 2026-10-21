-- Fuso da empresa: o "dia" de uma visita é o de Brasília, nunca o do aparelho nem o do servidor.
-- Espelha COMPANY_TIME_ZONE em src/domain/dates.ts (domain/schema-sync.test.ts confere os dois).
-- Brasília não tem horário de verão desde 2019, mas o banco de fusos cuida das datas antigas.

create function public.company_date(instant timestamptz) returns date
language sql stable
set search_path = ''
as $$
  select (instant at time zone 'America/Sao_Paulo')::date;
$$;

revoke all on function public.company_date(timestamptz) from public, anon;
grant execute on function public.company_date(timestamptz) to authenticated;
