begin;
select plan(10);

select is(
  public.company_date('2026-10-21 02:59:59.999+00'),
  '2026-10-20'::date,
  '23h59 em Brasília ainda é o dia anterior'
);
select is(
  public.company_date('2026-10-21 03:00:00+00'),
  '2026-10-21'::date,
  'à meia-noite de Brasília vira o dia'
);
select is(
  public.company_date('2026-10-22 02:30:00+00'),
  '2026-10-21'::date,
  'em UTC já é o dia seguinte; em Brasília ainda não'
);
select is(
  public.company_date('2026-10-20 23:30:00-03'),
  '2026-10-20'::date,
  'aceita instante escrito com deslocamento'
);
select is(
  public.company_date('2018-11-04 02:59:00+00'),
  '2018-11-03'::date,
  'também certo em datas do tempo do horário de verão'
);

-- O resultado não pode depender do fuso da sessão: é o ponto de ter uma função só para isso.
set local timezone = 'Pacific/Kiritimati';
select is(
  public.company_date('2026-10-21 02:59:59+00'),
  '2026-10-20'::date,
  'não muda com o fuso da sessão (Kiritimati, +14)'
);
set local timezone = 'America/Los_Angeles';
select is(
  public.company_date('2026-10-21 03:00:00+00'),
  '2026-10-21'::date,
  'não muda com o fuso da sessão (Los Angeles)'
);

select is(public.company_date(null), null::date, 'nulo continua nulo');

select ok(
  has_function_privilege('authenticated', 'public.company_date(timestamptz)', 'execute'),
  'quem está logado pode usar'
);
select ok(
  not has_function_privilege('anon', 'public.company_date(timestamptz)', 'execute'),
  'o papel anônimo não pode'
);

select * from finish();
rollback;
