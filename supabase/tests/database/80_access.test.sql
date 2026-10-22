begin;
select plan(48);

create schema tests;

create function tests.make_user(uid uuid, mail text, as_role public.user_role default 'supplier')
returns void language plpgsql as $$
begin
  insert into auth.users (id, email) values (uid, mail);
  update public.profiles set role = as_role, full_name = mail where id = uid;
end;
$$;

create function tests.login_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;

create function tests.today() returns date language sql as $$ select public.company_date(now()) $$;

-- Executa uma consulta que devolve jsonb como o usuário `uid` e volta a ser o dono do banco.
create function tests.call(uid uuid, q text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform tests.login_as(uid);
  execute q into r;
  reset role;
  return r;
end;
$$;

select tests.make_user('00000000-0000-0000-0000-0000000000a1', 'ana@test.dev');
select tests.make_user('00000000-0000-0000-0000-0000000000b1', 'bruno@test.dev');
select tests.make_user('00000000-0000-0000-0000-0000000000c1', 'admin1@test.dev', 'admin');
select tests.make_user('00000000-0000-0000-0000-0000000000c2', 'admin2@test.dev', 'admin');

insert into public.markets (id, name, capacity) values
  ('00000000-0000-0000-0000-0000000000e1', 'Mercado 1', 3);

------------------------------------------------------------------ perfil
select is(
  (select email from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'),
  'ana@test.dev',
  'o perfil guarda o e-mail do login'
);

select is(
  (select deactivated_at from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'),
  null,
  'conta nova nasce ativa'
);

------------------------------------------------------------------ desativar fornecedor
select is(
  tests.call('00000000-0000-0000-0000-0000000000a1',
    $$ select public.set_supplier_active_v1('00000000-0000-0000-0000-0000000000b1', false) $$),
  '{"ok": false, "code": "FORBIDDEN"}'::jsonb,
  'fornecedor não desativa ninguém'
);

select is(
  tests.call('00000000-0000-0000-0000-0000000000c1',
    $$ select public.set_supplier_active_v1('00000000-0000-0000-0000-0000000000f9', false) $$),
  '{"ok": false, "code": "NOT_FOUND"}'::jsonb,
  'perfil que não existe: NOT_FOUND'
);

select is(
  tests.call('00000000-0000-0000-0000-0000000000c1',
    $$ select public.set_supplier_active_v1('00000000-0000-0000-0000-0000000000c2', false) $$),
  '{"ok": false, "code": "NOT_FOUND"}'::jsonb,
  'por esta função só se desativa fornecedor: administrador também é NOT_FOUND'
);

-- A ana tem uma reserva futura, uma de hoje e uma já passada; o bruno, uma futura.
insert into public.bookings (market_id, day, supplier_id) values
  ('00000000-0000-0000-0000-0000000000e1', tests.today() + 3, '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000e1', tests.today(), '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000e1', tests.today() - 2, '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000e1', tests.today() + 3, '00000000-0000-0000-0000-0000000000b1');

select is(
  tests.call('00000000-0000-0000-0000-0000000000c1',
    $$ select public.set_supplier_active_v1('00000000-0000-0000-0000-0000000000a1', false) $$),
  '{"ok": true, "active": false, "cancelled": 2}'::jsonb,
  'desativar cancela as reservas de hoje em diante (2) e devolve quantas'
);

select is(
  (select count(*)::int from public.bookings
    where supplier_id = '00000000-0000-0000-0000-0000000000a1' and cancelled_at is null),
  1,
  'a reserva que já passou é histórico e continua'
);

select is(
  (select cancel_reason from public.bookings
    where supplier_id = '00000000-0000-0000-0000-0000000000a1' and day = tests.today() + 3),
  'Fornecedor desativado',
  'as reservas canceladas guardam o motivo'
);

select is(
  (select cancelled_by from public.bookings
    where supplier_id = '00000000-0000-0000-0000-0000000000a1' and day = tests.today() + 3),
  '00000000-0000-0000-0000-0000000000c1'::uuid,
  'e quem cancelou'
);

select is(
  (select count(*)::int from public.bookings
    where supplier_id = '00000000-0000-0000-0000-0000000000b1' and cancelled_at is null),
  1,
  'a reserva de outro fornecedor não é tocada'
);

select is(
  tests.call('00000000-0000-0000-0000-0000000000c1',
    $$ select public.set_supplier_active_v1('00000000-0000-0000-0000-0000000000a1', false) $$),
  '{"ok": true, "active": false, "cancelled": 0}'::jsonb,
  'desativar de novo é seguro: nada mais a cancelar'
);

------------------------------------------------------------------ conta desativada
select is(
  tests.call('00000000-0000-0000-0000-0000000000a1',
    $$ select public.book_slot_v1('00000000-0000-0000-0000-0000000000e1', public.company_date(now()) + 5) $$),
  '{"ok": false, "code": "FORBIDDEN"}'::jsonb,
  'conta desativada não reserva'
);

select is(
  tests.call('00000000-0000-0000-0000-0000000000a1',
    format('select public.cancel_booking_v1(%L)',
      (select id from public.bookings
        where supplier_id = '00000000-0000-0000-0000-0000000000a1' and day = tests.today() - 2))),
  '{"ok": false, "code": "FORBIDDEN"}'::jsonb,
  'conta desativada não cancela'
);

select is(
  tests.call('00000000-0000-0000-0000-0000000000a1',
    $$ select public.market_availability_v1('00000000-0000-0000-0000-0000000000e1', public.company_date(now()), public.company_date(now()) + 5) $$),
  '{"ok": false, "code": "FORBIDDEN"}'::jsonb,
  'conta desativada não vê a disponibilidade'
);

select tests.login_as('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.markets), 0, 'conta desativada não lê mercados');
select is((select count(*)::int from public.bookings), 0, 'conta desativada não lê nem as próprias reservas');
select is(
  (select count(*)::int from public.profiles where deactivated_at is not null),
  1,
  'mas lê o próprio perfil, e é assim que o app sabe avisar que a conta foi desativada'
);
reset role;

------------------------------------------------------------------ reativar
select is(
  tests.call('00000000-0000-0000-0000-0000000000c1',
    $$ select public.set_supplier_active_v1('00000000-0000-0000-0000-0000000000a1', true) $$),
  '{"ok": true, "active": true, "cancelled": 0}'::jsonb,
  'reativar devolve o acesso (as reservas canceladas não voltam)'
);

select ok(
  tests.call('00000000-0000-0000-0000-0000000000a1',
    $$ select public.book_slot_v1('00000000-0000-0000-0000-0000000000e1', public.company_date(now()) + 5) $$)
    @> '{"ok": true}'::jsonb,
  'conta reativada volta a reservar'
);

------------------------------------------------------------------ ninguém mexe no próprio acesso
select tests.login_as('00000000-0000-0000-0000-0000000000c1');

select throws_ok(
  $$ update public.profiles set deactivated_at = now() where id = '00000000-0000-0000-0000-0000000000c1' $$,
  '42501', 'profile_own_access_locked',
  'administrador não desativa a si mesmo'
);

select throws_ok(
  $$ update public.profiles set role = 'supplier' where id = '00000000-0000-0000-0000-0000000000c1' $$,
  '42501', 'profile_own_access_locked',
  'administrador não se rebaixa'
);

select throws_ok(
  $$ update public.profiles set email = 'outro@test.dev' where id = '00000000-0000-0000-0000-0000000000a1' $$,
  '42501', 'profile_email_is_managed',
  'o e-mail do perfil só muda junto com o login'
);

select lives_ok(
  $$ update public.profiles set full_name = 'Ana Souza' where id = '00000000-0000-0000-0000-0000000000a1' $$,
  'o administrador corrige o nome de um fornecedor'
);

-- Um administrador desativa o outro; o desativado deixa de administrar.
select lives_ok(
  $$ update public.profiles set deactivated_at = now() where id = '00000000-0000-0000-0000-0000000000c2' $$,
  'um administrador desativa o outro'
);
reset role;

select is(
  tests.call('00000000-0000-0000-0000-0000000000c2',
    $$ select public.set_supplier_active_v1('00000000-0000-0000-0000-0000000000b1', false) $$),
  '{"ok": false, "code": "FORBIDDEN"}'::jsonb,
  'administrador desativado deixa de administrar'
);

select tests.login_as('00000000-0000-0000-0000-0000000000c2');
select is((select count(*)::int from public.audit_log), 0, 'e não lê mais a auditoria');
reset role;

------------------------------------------------------------------ auditoria
select ok(
  exists (
    select 1 from public.audit_log
     where table_name = 'profiles' and row_id = '00000000-0000-0000-0000-0000000000a1'
       and changes ? 'deactivated_at'
       and actor_id = '00000000-0000-0000-0000-0000000000c1'
  ),
  'desativar uma conta fica na auditoria, com quem fez'
);

------------------------------------------------------------------ configuração do cadastro
select is(
  (select mode::text || ':' || coalesce(invite_code, 'sem código') from public.signup_settings),
  'closed:sem código',
  'o cadastro público nasce fechado e sem código'
);

select is((select count(*)::int from public.signup_settings), 1, 'há uma linha de configuração só');

select throws_ok(
  $$ insert into public.signup_settings (singleton) values (true) $$,
  '23505', null,
  'não dá para criar uma segunda linha de configuração'
);

select tests.login_as('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.signup_settings), 0, 'fornecedor não lê a configuração (o código é segredo)');
select is(
  public.set_signup_mode_v1('open'),
  '{"ok": false, "code": "FORBIDDEN"}'::jsonb,
  'fornecedor não muda o modo'
);
select is(
  public.regenerate_invite_code_v1(),
  '{"ok": false, "code": "FORBIDDEN"}'::jsonb,
  'fornecedor não gera código'
);
reset role;

select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select is((select count(*)::int from public.signup_settings), 1, 'o administrador lê a configuração');

select throws_ok(
  $$ update public.signup_settings set mode = 'open' $$,
  '42501', null,
  'nem o administrador grava direto na tabela: só pelas funções'
);

select throws_ok(
  $$ select public.generate_invite_code() $$,
  '42501', null,
  'o sorteio do código não é chamável pela API'
);

select is(
  (public.set_signup_mode_v1('invite') ->> 'mode'),
  'invite',
  'o administrador abre o cadastro por código'
);
reset role;

select matches(
  (select invite_code from public.signup_settings),
  '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$',
  'abrir o modo por código já cria o código: 8 caracteres, sem 0, O, 1, I'
);

create temp table first_code as select invite_code from public.signup_settings;
grant select on first_code to authenticated;

select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select is(
  (public.set_signup_mode_v1('invite') ->> 'invite_code'),
  (select invite_code from first_code),
  'repetir o modo não troca o código'
);

select isnt(
  (public.regenerate_invite_code_v1() ->> 'invite_code'),
  (select invite_code from first_code),
  'gerar novo código troca o código'
);

select is(
  (public.set_signup_mode_v1('closed') ->> 'mode'),
  'closed',
  'o administrador fecha o cadastro'
);
reset role;

select isnt(
  (select invite_code from public.signup_settings),
  null,
  'fechar o cadastro guarda o código (reabrir não força trocar)'
);

select is(
  (select updated_by from public.signup_settings),
  '00000000-0000-0000-0000-0000000000c1'::uuid,
  'a configuração guarda quem mudou por último'
);

select ok(
  exists (
    select 1 from public.audit_log
     where table_name = 'signup_settings' and action = 'update'
       and actor_id = '00000000-0000-0000-0000-0000000000c1'
  ),
  'mudar a configuração do cadastro fica na auditoria'
);

select is(
  (select count(*)::int from (
     select distinct public.generate_invite_code() as code from generate_series(1, 200)
   ) s
   where code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$'),
  200,
  'o sorteio produz códigos válidos e não repete em 200 tentativas'
);

------------------------------------------------------------------ tentativas de cadastro
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok(
  $$ select * from public.signup_attempts $$,
  '42501', null,
  'nem o administrador lê as tentativas pela API (só a chave de serviço)'
);
reset role;

set local role anon;
select throws_ok($$ select * from public.signup_settings $$, '42501', null, 'anônimo não lê a configuração');
select throws_ok($$ select * from public.signup_attempts $$, '42501', null, 'anônimo não lê as tentativas');
reset role;

select * from finish();
rollback;
