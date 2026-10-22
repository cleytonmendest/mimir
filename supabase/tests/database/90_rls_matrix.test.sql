begin;
select plan(144);

-- Matriz de acesso: cada papel x cada tabela x cada operação, contra os mesmos dados. O resultado
-- esperado é "ok:N" (a operação rodou e atingiu/devolveu N linhas; 0 = o RLS escondeu tudo) ou
-- "err:42501" (privilégio ou policy recusou). Quem mudar uma policy ou um privilégio sem querer
-- quebra aqui, e a linha que quebrou diz qual papel, tabela e operação foi.
--
-- Papéis: anon; ana (fornecedora ativa); dora (fornecedora desativada); lia (administradora ativa);
-- vera (administradora desativada).

create schema tests;

create function tests.make_user(uid uuid, mail text, as_role public.user_role default 'supplier')
returns void language plpgsql as $$
begin
  insert into auth.users (id, email) values (uid, mail);
  update public.profiles set role = as_role, full_name = mail where id = uid;
end;
$$;

-- Tenta a operação como o papel dado e devolve o resultado, desfazendo sempre o efeito para a
-- próxima tentativa ver os mesmos dados.
create function tests.attempt(who text, q text) returns text language plpgsql as $$
declare
  n bigint;
  result text;
  uid uuid := case who
    when 'ana' then '00000000-0000-0000-0000-0000000000a1'::uuid
    when 'dora' then '00000000-0000-0000-0000-0000000000d1'::uuid
    when 'lia' then '00000000-0000-0000-0000-0000000000c1'::uuid
    when 'vera' then '00000000-0000-0000-0000-0000000000c2'::uuid
  end;
begin
  begin
    if who = 'anon' then
      set local role anon;
    else
      perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
      set local role authenticated;
    end if;
    execute q;
    get diagnostics n = row_count;
    result := 'ok:' || n;
    raise exception 'desfaz' using errcode = 'P0042';
  exception when others then
    if sqlstate <> 'P0042' then
      result := 'err:' || sqlstate;
    end if;
  end;
  return result;
end;
$$;

select tests.make_user('00000000-0000-0000-0000-0000000000a1', 'ana@test.dev');
select tests.make_user('00000000-0000-0000-0000-0000000000b1', 'bruno@test.dev');
select tests.make_user('00000000-0000-0000-0000-0000000000d1', 'dora@test.dev');
select tests.make_user('00000000-0000-0000-0000-0000000000c1', 'lia@test.dev', 'admin');
select tests.make_user('00000000-0000-0000-0000-0000000000c2', 'vera@test.dev', 'admin');
update public.profiles set deactivated_at = now()
  where id in ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c2');

insert into public.markets (id, name, capacity) values ('00000000-0000-0000-0000-0000000000e1', 'Mercado da matriz', 3);
insert into public.closed_days (market_id, day) values ('00000000-0000-0000-0000-0000000000e1', public.company_date(now()) + 20);
insert into public.bookings (market_id, day, supplier_id) values
  ('00000000-0000-0000-0000-0000000000e1', public.company_date(now()) + 10, '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000e1', public.company_date(now()) + 10, '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000e1', public.company_date(now()) + 11, '00000000-0000-0000-0000-0000000000d1');
insert into public.signup_attempts (ip_hash, email_hash, outcome) values ('h1', 'h2', 'created');

------------------------------------------------------------------ a matriz
select is(
  tests.attempt(who, sql),
  expected,
  who || ' · ' || tab || ' · ' || op
)
from (values
  ('anon', 'profiles', 'select', $q$select * from public.profiles$q$, 'err:42501'),
  ('ana', 'profiles', 'select', $q$select * from public.profiles$q$, 'ok:1'),
  ('dora', 'profiles', 'select', $q$select * from public.profiles$q$, 'ok:1'),
  ('lia', 'profiles', 'select', $q$select * from public.profiles$q$, 'ok:5'),
  ('vera', 'profiles', 'select', $q$select * from public.profiles$q$, 'ok:1'),
  ('anon', 'profiles', 'insert', $q$insert into public.profiles (id, role) values (gen_random_uuid(), 'admin')$q$, 'err:42501'),
  ('ana', 'profiles', 'insert', $q$insert into public.profiles (id, role) values (gen_random_uuid(), 'admin')$q$, 'err:42501'),
  ('dora', 'profiles', 'insert', $q$insert into public.profiles (id, role) values (gen_random_uuid(), 'admin')$q$, 'err:42501'),
  ('lia', 'profiles', 'insert', $q$insert into public.profiles (id, role) values (gen_random_uuid(), 'admin')$q$, 'err:42501'),
  ('vera', 'profiles', 'insert', $q$insert into public.profiles (id, role) values (gen_random_uuid(), 'admin')$q$, 'err:42501'),
  ('anon', 'profiles', 'update', $q$update public.profiles set full_name = full_name$q$, 'err:42501'),
  ('ana', 'profiles', 'update', $q$update public.profiles set full_name = full_name$q$, 'ok:0'),
  ('dora', 'profiles', 'update', $q$update public.profiles set full_name = full_name$q$, 'ok:0'),
  ('lia', 'profiles', 'update', $q$update public.profiles set full_name = full_name$q$, 'ok:5'),
  ('vera', 'profiles', 'update', $q$update public.profiles set full_name = full_name$q$, 'ok:0'),
  ('anon', 'profiles', 'delete', $q$delete from public.profiles$q$, 'err:42501'),
  ('ana', 'profiles', 'delete', $q$delete from public.profiles$q$, 'err:42501'),
  ('dora', 'profiles', 'delete', $q$delete from public.profiles$q$, 'err:42501'),
  ('lia', 'profiles', 'delete', $q$delete from public.profiles$q$, 'err:42501'),
  ('vera', 'profiles', 'delete', $q$delete from public.profiles$q$, 'err:42501'),
  ('anon', 'markets', 'select', $q$select * from public.markets$q$, 'err:42501'),
  ('ana', 'markets', 'select', $q$select * from public.markets$q$, 'ok:1'),
  ('dora', 'markets', 'select', $q$select * from public.markets$q$, 'ok:0'),
  ('lia', 'markets', 'select', $q$select * from public.markets$q$, 'ok:1'),
  ('vera', 'markets', 'select', $q$select * from public.markets$q$, 'ok:0'),
  ('anon', 'markets', 'insert', $q$insert into public.markets (name) values ('Matriz')$q$, 'err:42501'),
  ('ana', 'markets', 'insert', $q$insert into public.markets (name) values ('Matriz')$q$, 'err:42501'),
  ('dora', 'markets', 'insert', $q$insert into public.markets (name) values ('Matriz')$q$, 'err:42501'),
  ('lia', 'markets', 'insert', $q$insert into public.markets (name) values ('Matriz')$q$, 'ok:1'),
  ('vera', 'markets', 'insert', $q$insert into public.markets (name) values ('Matriz')$q$, 'err:42501'),
  ('anon', 'markets', 'update', $q$update public.markets set name = name$q$, 'err:42501'),
  ('ana', 'markets', 'update', $q$update public.markets set name = name$q$, 'ok:0'),
  ('dora', 'markets', 'update', $q$update public.markets set name = name$q$, 'ok:0'),
  ('lia', 'markets', 'update', $q$update public.markets set name = name$q$, 'ok:1'),
  ('vera', 'markets', 'update', $q$update public.markets set name = name$q$, 'ok:0'),
  ('anon', 'markets', 'delete', $q$delete from public.markets$q$, 'err:42501'),
  ('ana', 'markets', 'delete', $q$delete from public.markets$q$, 'err:42501'),
  ('dora', 'markets', 'delete', $q$delete from public.markets$q$, 'err:42501'),
  ('lia', 'markets', 'delete', $q$delete from public.markets$q$, 'err:42501'),
  ('vera', 'markets', 'delete', $q$delete from public.markets$q$, 'err:42501'),
  ('anon', 'closed_days', 'select', $q$select * from public.closed_days$q$, 'err:42501'),
  ('ana', 'closed_days', 'select', $q$select * from public.closed_days$q$, 'ok:1'),
  ('dora', 'closed_days', 'select', $q$select * from public.closed_days$q$, 'ok:0'),
  ('lia', 'closed_days', 'select', $q$select * from public.closed_days$q$, 'ok:1'),
  ('vera', 'closed_days', 'select', $q$select * from public.closed_days$q$, 'ok:0'),
  ('anon', 'closed_days', 'insert', $q$insert into public.closed_days (market_id, day) values ('00000000-0000-0000-0000-0000000000e1', public.company_date(now()) + 40)$q$, 'err:42501'),
  ('ana', 'closed_days', 'insert', $q$insert into public.closed_days (market_id, day) values ('00000000-0000-0000-0000-0000000000e1', public.company_date(now()) + 40)$q$, 'err:42501'),
  ('dora', 'closed_days', 'insert', $q$insert into public.closed_days (market_id, day) values ('00000000-0000-0000-0000-0000000000e1', public.company_date(now()) + 40)$q$, 'err:42501'),
  ('lia', 'closed_days', 'insert', $q$insert into public.closed_days (market_id, day) values ('00000000-0000-0000-0000-0000000000e1', public.company_date(now()) + 40)$q$, 'ok:1'),
  ('vera', 'closed_days', 'insert', $q$insert into public.closed_days (market_id, day) values ('00000000-0000-0000-0000-0000000000e1', public.company_date(now()) + 40)$q$, 'err:42501'),
  ('anon', 'closed_days', 'update', $q$update public.closed_days set reason = 'x'$q$, 'err:42501'),
  ('ana', 'closed_days', 'update', $q$update public.closed_days set reason = 'x'$q$, 'ok:0'),
  ('dora', 'closed_days', 'update', $q$update public.closed_days set reason = 'x'$q$, 'ok:0'),
  ('lia', 'closed_days', 'update', $q$update public.closed_days set reason = 'x'$q$, 'ok:1'),
  ('vera', 'closed_days', 'update', $q$update public.closed_days set reason = 'x'$q$, 'ok:0'),
  ('anon', 'closed_days', 'delete', $q$delete from public.closed_days$q$, 'err:42501'),
  ('ana', 'closed_days', 'delete', $q$delete from public.closed_days$q$, 'ok:0'),
  ('dora', 'closed_days', 'delete', $q$delete from public.closed_days$q$, 'ok:0'),
  ('lia', 'closed_days', 'delete', $q$delete from public.closed_days$q$, 'ok:1'),
  ('vera', 'closed_days', 'delete', $q$delete from public.closed_days$q$, 'ok:0'),
  ('anon', 'bookings', 'select', $q$select * from public.bookings$q$, 'err:42501'),
  ('ana', 'bookings', 'select', $q$select * from public.bookings$q$, 'ok:1'),
  ('dora', 'bookings', 'select', $q$select * from public.bookings$q$, 'ok:0'),
  ('lia', 'bookings', 'select', $q$select * from public.bookings$q$, 'ok:3'),
  ('vera', 'bookings', 'select', $q$select * from public.bookings$q$, 'ok:0'),
  ('anon', 'bookings', 'insert', $q$insert into public.bookings (market_id, day, supplier_id) values ('00000000-0000-0000-0000-0000000000e1', public.company_date(now()) + 41, '00000000-0000-0000-0000-0000000000a1')$q$, 'err:42501'),
  ('ana', 'bookings', 'insert', $q$insert into public.bookings (market_id, day, supplier_id) values ('00000000-0000-0000-0000-0000000000e1', public.company_date(now()) + 41, '00000000-0000-0000-0000-0000000000a1')$q$, 'err:42501'),
  ('dora', 'bookings', 'insert', $q$insert into public.bookings (market_id, day, supplier_id) values ('00000000-0000-0000-0000-0000000000e1', public.company_date(now()) + 41, '00000000-0000-0000-0000-0000000000a1')$q$, 'err:42501'),
  ('lia', 'bookings', 'insert', $q$insert into public.bookings (market_id, day, supplier_id) values ('00000000-0000-0000-0000-0000000000e1', public.company_date(now()) + 41, '00000000-0000-0000-0000-0000000000a1')$q$, 'err:42501'),
  ('vera', 'bookings', 'insert', $q$insert into public.bookings (market_id, day, supplier_id) values ('00000000-0000-0000-0000-0000000000e1', public.company_date(now()) + 41, '00000000-0000-0000-0000-0000000000a1')$q$, 'err:42501'),
  ('anon', 'bookings', 'update', $q$update public.bookings set cancel_reason = null$q$, 'err:42501'),
  ('ana', 'bookings', 'update', $q$update public.bookings set cancel_reason = null$q$, 'err:42501'),
  ('dora', 'bookings', 'update', $q$update public.bookings set cancel_reason = null$q$, 'err:42501'),
  ('lia', 'bookings', 'update', $q$update public.bookings set cancel_reason = null$q$, 'err:42501'),
  ('vera', 'bookings', 'update', $q$update public.bookings set cancel_reason = null$q$, 'err:42501'),
  ('anon', 'bookings', 'delete', $q$delete from public.bookings$q$, 'err:42501'),
  ('ana', 'bookings', 'delete', $q$delete from public.bookings$q$, 'err:42501'),
  ('dora', 'bookings', 'delete', $q$delete from public.bookings$q$, 'err:42501'),
  ('lia', 'bookings', 'delete', $q$delete from public.bookings$q$, 'err:42501'),
  ('vera', 'bookings', 'delete', $q$delete from public.bookings$q$, 'err:42501'),
  ('anon', 'audit_log', 'select', $q$select * from public.audit_log$q$, 'err:42501'),
  ('ana', 'audit_log', 'select', $q$select * from public.audit_log$q$, 'ok:0'),
  ('dora', 'audit_log', 'select', $q$select * from public.audit_log$q$, 'ok:0'),
  ('lia', 'audit_log', 'select', $q$select * from public.audit_log$q$, 'ok:' || (select count(*) from public.audit_log)),
  ('vera', 'audit_log', 'select', $q$select * from public.audit_log$q$, 'ok:0'),
  ('anon', 'audit_log', 'insert', $q$insert into public.audit_log (table_name, row_id, action) values ('x', gen_random_uuid(), 'insert')$q$, 'err:42501'),
  ('ana', 'audit_log', 'insert', $q$insert into public.audit_log (table_name, row_id, action) values ('x', gen_random_uuid(), 'insert')$q$, 'err:42501'),
  ('dora', 'audit_log', 'insert', $q$insert into public.audit_log (table_name, row_id, action) values ('x', gen_random_uuid(), 'insert')$q$, 'err:42501'),
  ('lia', 'audit_log', 'insert', $q$insert into public.audit_log (table_name, row_id, action) values ('x', gen_random_uuid(), 'insert')$q$, 'err:42501'),
  ('vera', 'audit_log', 'insert', $q$insert into public.audit_log (table_name, row_id, action) values ('x', gen_random_uuid(), 'insert')$q$, 'err:42501'),
  ('anon', 'audit_log', 'update', $q$update public.audit_log set table_name = table_name$q$, 'err:42501'),
  ('ana', 'audit_log', 'update', $q$update public.audit_log set table_name = table_name$q$, 'err:42501'),
  ('dora', 'audit_log', 'update', $q$update public.audit_log set table_name = table_name$q$, 'err:42501'),
  ('lia', 'audit_log', 'update', $q$update public.audit_log set table_name = table_name$q$, 'err:42501'),
  ('vera', 'audit_log', 'update', $q$update public.audit_log set table_name = table_name$q$, 'err:42501'),
  ('anon', 'audit_log', 'delete', $q$delete from public.audit_log$q$, 'err:42501'),
  ('ana', 'audit_log', 'delete', $q$delete from public.audit_log$q$, 'err:42501'),
  ('dora', 'audit_log', 'delete', $q$delete from public.audit_log$q$, 'err:42501'),
  ('lia', 'audit_log', 'delete', $q$delete from public.audit_log$q$, 'err:42501'),
  ('vera', 'audit_log', 'delete', $q$delete from public.audit_log$q$, 'err:42501'),
  ('anon', 'signup_settings', 'select', $q$select * from public.signup_settings$q$, 'err:42501'),
  ('ana', 'signup_settings', 'select', $q$select * from public.signup_settings$q$, 'ok:0'),
  ('dora', 'signup_settings', 'select', $q$select * from public.signup_settings$q$, 'ok:0'),
  ('lia', 'signup_settings', 'select', $q$select * from public.signup_settings$q$, 'ok:1'),
  ('vera', 'signup_settings', 'select', $q$select * from public.signup_settings$q$, 'ok:0'),
  ('anon', 'signup_settings', 'insert', $q$insert into public.signup_settings (singleton) values (true)$q$, 'err:42501'),
  ('ana', 'signup_settings', 'insert', $q$insert into public.signup_settings (singleton) values (true)$q$, 'err:42501'),
  ('dora', 'signup_settings', 'insert', $q$insert into public.signup_settings (singleton) values (true)$q$, 'err:42501'),
  ('lia', 'signup_settings', 'insert', $q$insert into public.signup_settings (singleton) values (true)$q$, 'err:42501'),
  ('vera', 'signup_settings', 'insert', $q$insert into public.signup_settings (singleton) values (true)$q$, 'err:42501'),
  ('anon', 'signup_settings', 'update', $q$update public.signup_settings set mode = 'open'$q$, 'err:42501'),
  ('ana', 'signup_settings', 'update', $q$update public.signup_settings set mode = 'open'$q$, 'err:42501'),
  ('dora', 'signup_settings', 'update', $q$update public.signup_settings set mode = 'open'$q$, 'err:42501'),
  ('lia', 'signup_settings', 'update', $q$update public.signup_settings set mode = 'open'$q$, 'err:42501'),
  ('vera', 'signup_settings', 'update', $q$update public.signup_settings set mode = 'open'$q$, 'err:42501'),
  ('anon', 'signup_settings', 'delete', $q$delete from public.signup_settings$q$, 'err:42501'),
  ('ana', 'signup_settings', 'delete', $q$delete from public.signup_settings$q$, 'err:42501'),
  ('dora', 'signup_settings', 'delete', $q$delete from public.signup_settings$q$, 'err:42501'),
  ('lia', 'signup_settings', 'delete', $q$delete from public.signup_settings$q$, 'err:42501'),
  ('vera', 'signup_settings', 'delete', $q$delete from public.signup_settings$q$, 'err:42501'),
  ('anon', 'signup_attempts', 'select', $q$select * from public.signup_attempts$q$, 'err:42501'),
  ('ana', 'signup_attempts', 'select', $q$select * from public.signup_attempts$q$, 'err:42501'),
  ('dora', 'signup_attempts', 'select', $q$select * from public.signup_attempts$q$, 'err:42501'),
  ('lia', 'signup_attempts', 'select', $q$select * from public.signup_attempts$q$, 'err:42501'),
  ('vera', 'signup_attempts', 'select', $q$select * from public.signup_attempts$q$, 'err:42501'),
  ('anon', 'signup_attempts', 'insert', $q$insert into public.signup_attempts (ip_hash, email_hash, outcome) values ('a', 'b', 'c')$q$, 'err:42501'),
  ('ana', 'signup_attempts', 'insert', $q$insert into public.signup_attempts (ip_hash, email_hash, outcome) values ('a', 'b', 'c')$q$, 'err:42501'),
  ('dora', 'signup_attempts', 'insert', $q$insert into public.signup_attempts (ip_hash, email_hash, outcome) values ('a', 'b', 'c')$q$, 'err:42501'),
  ('lia', 'signup_attempts', 'insert', $q$insert into public.signup_attempts (ip_hash, email_hash, outcome) values ('a', 'b', 'c')$q$, 'err:42501'),
  ('vera', 'signup_attempts', 'insert', $q$insert into public.signup_attempts (ip_hash, email_hash, outcome) values ('a', 'b', 'c')$q$, 'err:42501'),
  ('anon', 'signup_attempts', 'update', $q$update public.signup_attempts set outcome = outcome$q$, 'err:42501'),
  ('ana', 'signup_attempts', 'update', $q$update public.signup_attempts set outcome = outcome$q$, 'err:42501'),
  ('dora', 'signup_attempts', 'update', $q$update public.signup_attempts set outcome = outcome$q$, 'err:42501'),
  ('lia', 'signup_attempts', 'update', $q$update public.signup_attempts set outcome = outcome$q$, 'err:42501'),
  ('vera', 'signup_attempts', 'update', $q$update public.signup_attempts set outcome = outcome$q$, 'err:42501'),
  ('anon', 'signup_attempts', 'delete', $q$delete from public.signup_attempts$q$, 'err:42501'),
  ('ana', 'signup_attempts', 'delete', $q$delete from public.signup_attempts$q$, 'err:42501'),
  ('dora', 'signup_attempts', 'delete', $q$delete from public.signup_attempts$q$, 'err:42501'),
  ('lia', 'signup_attempts', 'delete', $q$delete from public.signup_attempts$q$, 'err:42501'),
  ('vera', 'signup_attempts', 'delete', $q$delete from public.signup_attempts$q$, 'err:42501')
) as matrix (who, tab, op, sql, expected);

------------------------------------------------------------------ funções que a API pode chamar
select is(
  (select array_agg(p.proname::text order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')),
  null,
  'o papel anon não executa nenhuma função de public'
);

select is(
  (select array_agg(p.proname::text order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')),
  array[
    'book_slot_v1', 'cancel_booking_v1', 'company_date', 'is_active_user', 'is_admin',
    'market_availability_v1', 'regenerate_invite_code_v1', 'set_signup_mode_v1', 'set_supplier_active_v1'
  ],
  'logado executa só as funções públicas do produto (nada de gatilho, sorteio ou auditoria)'
);

select is_empty(
  $$
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('book_slot_v1', 'cancel_booking_v1', 'market_availability_v1',
       'set_supplier_active_v1', 'set_signup_mode_v1', 'regenerate_invite_code_v1')
       and not p.prosecdef
  $$,
  'as funções de escrita e de leitura agregada rodam como dono (security definer), com search_path fixo'
);

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and roles <> '{authenticated}'),
  0,
  'toda policy vale só para o papel authenticated'
);

select * from finish();
rollback;
