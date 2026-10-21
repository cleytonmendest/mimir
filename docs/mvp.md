# Plano do MVP: Rota do repositor

> Aprovado em 21/10/2026. Este é o plano de referência; as decisões de arquitetura estão em [`docs/adr/`](adr). Atualize-o quando uma decisão mudar.

## Contexto

O produto é um PWA para repositores (quem repõe produtos em mercados) executarem a rota diária no celular, muitas vezes sem sinal, e para o líder planejar a semana e acompanhar o dia, com tudo auditado.

Já existe na `main` (817737e, CI verde): regras de negócio completas e 100% testadas em `src/domain`; banco com RLS, auditoria e trigger de guarda; login por e-mail e senha; tela "Hoje" do repositor (**online**); E2E real desse fluxo; CI com pgTAP, tipos gerados e E2E contra Supabase local.

Falta transformar isso em produto operável: offline, visão do líder, cadastros, fechamento do dia e implantação. Este plano leva até o MVP, na ordem de risco, em fatias do tamanho de um PR.

## Decisões fixas (dono do produto)

1. **Líder:** acompanhar o dia, planejar a semana **e cadastrar** (mercados, rota padrão, usuários) pela interface. Usa **computador e celular** (tela responsiva).
2. **Sem comprovação** no check-in (sem GPS, sem foto).
3. **Fim do dia:** job automático que **só marca "não foi"**; não passa sobras sozinho, o líder remaneja.
4. **Nenhum usuário real até o MVP completo.** Há homologação privada com HTTPS desde o começo (service worker exige HTTPS; offline se testa em celular real). A saída do MVP é um piloto controlado.
5. **Líder é online-only.** Offline é só do repositor.
6. **Login por e-mail** (todos têm). O líder cria o usuário e o servidor gera uma **senha temporária** (trocada no primeiro acesso), sem depender de envio de e-mail no MVP.
7. **Qualquer líder vê e edita tudo** (sem equipes; o RLS atual já é assim).
8. **Um fuso só:** horário de Brasília. O "dia" é calculado pelo servidor nesse fuso, não pelo aparelho.

## O que a revisão independente mudou (e que adoto)

1. **Via única de escrita do repositor:** online ou offline, tudo vira evento e passa pela mesma RPC; o `UPDATE` direto do repositor em `visits` é revogado. Garante "tudo é auditado" e elimina duas regras divergentes.
2. **Visitas criadas pelo servidor** (job noturno): hoje o aparelho as gera ao abrir o app, então o líder vê dia vazio se o repositor não abre, e o fechamento do dia não tem o que fechar.
3. **Fuso da empresa em todo lugar:** hoje `src/features/today/clock.ts` usa o fuso do aparelho.
4. **Ordem pelo `seq` do aparelho**, não por `occurredAt` (relógio corrigido no meio do dia quebraria a ordem), e **fila única por aparelho**.
5. **Fechar o dia D às 03:00 de D+1.** Evento que chega depois volta recusado e cai numa **caixa do líder** com "aplicar" (individual ou em lote). Abandono "evento tardio vence o fechamento": custo alto, e o líder não conseguiria remanejar visita `planned` de ontem. Reavaliar com os dados do teste de campo ("2 dias sem rede").
6. **O app precisa abrir sem rede:** hoje não abre, nem com service worker (`AuthProvider` busca o perfil toda vez). Guardar a identidade no aparelho.
7. **Marco 0 de fundação** e **job diário antes das telas do líder**.
8. **Usuários com senha temporária gerada no servidor**, por Edge Function.

## Marcos

| #   | Marco                        | Entrega                                                             | Tam. |
| --- | ---------------------------- | ------------------------------------------------------------------- | ---- |
| 0   | Fundação de campo            | README/ADRs, fuso, versão do app, homologação HTTPS, Sentry, spikes | M    |
| 1   | Offline do repositor         | PWA, fila local, sincronização idempotente, auth offline, via única | G    |
| 2   | Job diário                   | Fecha o passado e cria as visitas futuras (pg_cron)                 | P/M  |
| 3   | Líder: acompanhar e planejar | Dia, Semana, remanejar, recusados, histórico, ausências             | G    |
| 4   | Cadastros e acesso           | Mercados, rota padrão, usuários (Edge Function), primeiro acesso    | M    |
| 5   | Produção e endurecimento     | Produção, performance, segurança, LGPD, runbooks, piloto            | M    |

Tamanhos relativos (P/M/G), não prazos. Dependências críticas: 0.2 → 1.1/1.2; 0.4 → spike S2 → 1.8/1.11; 1.2 → 1.3 → 1.5 → 1.7 → 1.9; 2.2 → 3.3; 4.1 → 4.4 → 4.5/4.6.

## Desenho do offline (contrato revisado)

**Aparelho** (IndexedDB via `idb`; testes com `fake-indexeddb`)

- Banco `rota-device`: `deviceId` e última identidade. Um banco **por usuário** (`rota-<userId>`): `snapshot` (visitas, mercados, rota, `fetchedAt`, diferença de relógio), `outbox` (`seq` autoIncrement, `clientEventId`, `visitId`, `type`, `payload`, `occurredAt`, `offsetMs`, `causedBy`, estado), `meta`.
- A tela mostra `projectVisits(snapshot, pendentes)`, função pura no domínio.
- Quando o domínio encerra uma visita aberta (`execution.checkIn`), o aparelho grava **na mesma transação** o evento do usuário e os eventos **derivados** explícitos (check-out automático com a mesma regra de horário de `execution.ts`, ou "não fui: Sem check-out" se for de dia passado). O servidor não tem regra entre visitas.
- Sincroniza ao abrir, em `visibilitychange`, em `online`, depois de cada ação, por timer enquanto houver pendência e no botão "enviar". Sem Background Sync (não existe no iOS). `navigator.storage.persist()`.
- O service worker **não guarda** resposta do Supabase (NetworkOnly); o dado offline mora só no IndexedDB.

**Servidor** (`sync_visit_events_v1(device_id, client_version, events jsonb)`, `SECURITY DEFINER`, `search_path = ''`)

- Trava a visita (`FOR UPDATE`), procura o `client_event_id` (se existe e é do mesmo ator, devolve o resultado gravado; se é de outro, `ID_CONFLICT`), avalia, atualiza a visita, **insere o evento com o resultado** (a tabela é imutável).
- Tabela de transição: `checkIn` (espera `planned`, e `visit_date = company_date(occurred_at)`) → `in_progress`; `checkOut` (espera `in_progress`, `occurred_at >= check_in_at`) → `done`; `markNotDone` (espera `planned|in_progress`, `visit_date <= company_date`, motivo não vazio) → `not_done`.
- Recusa com código: `VISIT_CANCELLED`, `ALREADY_DONE`, `INVALID_TRANSITION` (com status e motivo atuais), `CLOCK_INVALID` (`occurred_at > now() + 10 min`), `VISIT_NOT_FOUND`, `ID_CONFLICT`, `INVALID_DATA`, `upgrade_required`.
- O servidor calcula o dia no fuso da empresa; a data do aparelho fica só para diagnóstico. Devolve `{server_now, results[], visits[]}`.
- Mantém o trigger `guard_visit_update` (usa `auth.uid()` do JWT, vale também em função `DEFINER`) e checa explicitamente `repositor_id = auth.uid()`, papel e usuário ativo. Nome com versão (`_v1`): a assinatura nunca muda; a v2 convive.

**Modos de falha tratados**: sincronização parcial (lote até 50, subtransação por evento, atualizar cópia e tirar da fila numa transação só, espera crescente 2 s–5 min com variação); relógio errado (diferença guardada, aviso acima de 5 min); 2 aparelhos (`device_id` + `device_seq`, trava na visita, `ALREADY_DONE` não aparece como erro); token expirado offline (identidade guardada, envia só com a sessão do dono); troca de usuário (banco por usuário, RPC confere o dono, sair com pendências pede confirmação); iOS apaga dados (exigir app instalado, contador de pendências, `persist()`); evento depois de cancelamento/remanejo (resposta explica; recusados ficam na caixa do líder); app antigo × schema novo (RPC versionada, `min_client_version`, mappers validam enums, só acrescentar schema).

## Fatias por marco (cada uma, um PR)

### Marco 0: Fundação de campo

- **0.1 README e ADRs** (como rodar, variáveis, testes, deploy; ADRs de offline, fuso, conflitos, retenção). _Teste:_ seguir o README do zero.
- **0.2 Fuso da empresa:** `COMPANY_TIME_ZONE` e `companyDate()` em `src/domain/dates.ts`; `clock.ts` passa a usá-los; migration com `company_date()`. _Teste:_ matriz de 4 fusos existente + pgTAP em 23:59 e 00:01 de Brasília.
- **0.3 Versão do app:** `define` no `vite.config.ts`, visível no `AccountBar`, enviada em header.
- **0.4 Homologação HTTPS:** projeto Supabase `sa-east-1` (plano que não pausa), Cloudflare Pages (SPA fallback e `_headers`), `deploy-homolog.yml` (`supabase db push` → build → varredura do `dist/` com os padrões de `scripts/guards/no-service-role.ts` → deploy), `site_url` e redirects, `scripts/seed-homolog.ts` fora de `src`. _Pronto:_ login num celular real pela URL.
- **0.5 Observabilidade mínima:** Sentry com `release`, sem dado pessoal, ErrorBoundary.
- **0.6 Spikes** S1, S2, S3, S5, S6, S7 (tabela abaixo), resultados nos ADRs.

### Marco 1: Offline do repositor

- **1.1 Domínio (puro, 100% de cobertura):** `seq` em `OfflineEvent` e ordenação por ele em `sync.ts`; `checkInEvents()` em `execution.ts` (eventos derivados, com teste de propriedade de equivalência com `checkIn`, via `fast-check`); `projectVisits()`; check-in só no mesmo dia (hoje `status.ts` só barra o futuro); casos de teste compartilhados em `src/domain/fixtures/visit-events.cases.json`.
- **1.2 Migration da sincronização:** colunas `outcome`, `rejection_code`, `device_id`, `device_seq`, `client_version` em `visit_events`; `audit_log.source` e `audit_row_change` gravando só a diferença no update (o log completo estouraria o plano gratuito em ~1 ano); `app_config` (`min_client_version`) e `device_status`; `sync_visit_events_v1`; **revogar o INSERT direto em `visit_events`**; índices `visits(repositor_id, visit_date)` e `visit_events(visit_id)`. Um gerador escreve o pgTAP a partir do JSON de 1.1, com teste Vitest que confere se está atualizado (padrão de `schema-sync.test.ts`). Atualizar `30_audit` e `40_visit_events`; regerar `database.types.ts`.
- **1.3 Transporte:** `src/lib/supabase/sync-gateway.ts` (distingue rede, servidor e "atualize o app"). _Teste:_ unidade + API do Playwright com 10 chamadas simultâneas do mesmo `client_event_id` resultando em 1 linha.
- **1.4 Armazenamento local:** `src/lib/offline/store.ts` com `idb` (banco por usuário, `enqueue`/`ack` atômicos, migração de versão, versão em memória para testes). ESLint: `idb` só em `src/lib`.
- **1.5 Motor de sincronização:** `src/lib/offline/sync-engine.ts`. _Teste:_ de propriedade, com transporte falso que perde resposta depois de gravar, falha antes, duplica e atrasa; invariantes: nada se perde, nada se aplica duas vezes, a fila esvazia, estado final igual ao de um modelo sequencial.
- **1.6 Autenticação offline:** identidade guardada em `auth.ts`; estado `offline` no `AuthProvider`; sair com pendências pede confirmação. _Teste:_ E2E com `page.clock` +2 h sem rede e recarregando.
- **1.7 Hoje offline:** `today-controller.ts` troca `gateway.saveChanges` por enfileirar + enviar; abre com a cópia local; `pendingCount`, "atualizado às", recusados explicados; componente `SyncStatus` (com story); tela de **Diagnóstico** (versão, `deviceId`, pendências, último envio, "enviar agora", "copiar").
- **1.8 PWA:** `vite-plugin-pwa` (2.0.0, suporta Vite 8), manifest, ícones (`theme_color` conferido contra o token), `UpdateBanner`, tela de versão mínima que **não apaga a fila**, instruções de instalação no iOS. _Teste:_ novo projeto Playwright contra `vite preview` (o dev server tem outro service worker); recarregar sem rede mostra a tela Hoje.
- **1.9 Via única:** migration limitando `visits_update` ao líder; o repositor deixa de usar `saveVisitChange`. _Teste:_ pgTAP (UPDATE direto do repositor é negado).
- **1.10 E2E offline:** (a) check-in/out sem rede → volta a rede → banco confere; (b) recarregar sem rede mantém pendências; (c) admin cancela com o aparelho offline → explicação; (d) resposta abortada depois de gravar → sem duplicata.
- **1.11 Protocolo de campo** (`docs/homologacao/offline.md`): modo avião, app encerrado à força, reinício, 2 dias sem rede, relógio errado, em 1 Android e 1 iPhone.

### Marco 2: Job diário

- **2.1 `close_past_days(p_today)`:** `SECURITY DEFINER`, sem permissão para clientes; pega todos os dias passados (recupera sozinho se uma noite falhar); `app.source = 'system'`; mesmos textos de `NO_RECORD_REASON`/`NO_CHECKOUT_REASON` (teste confere). Casos compartilhados com `closeDay`.
- **2.2 `materialize_visits(p_from, p_days)`:** `INSERT … SELECT` da rota padrão, ignorando mercado arquivado, `ON CONFLICT DO NOTHING`; `generateWeek` ganha o mesmo filtro.
- **2.3 Agendamento:** pg_cron às 06:00 UTC (03:00 de Brasília): fecha e depois cria 14 dias; view de saúde do job, legível pelo líder.
- **2.4** O aparelho para de gerar a semana (remove `generateWeek`/`createVisits` do controller); `e2e/support/seed.ts` passa a chamar `materialize_visits`.

### Marco 3: Líder

- **3.0 Permissões finais:** mercados, rota padrão e INSERT de visitas só para o líder (`src/domain/permissions.ts` com snapshot atualizado). _Proposta; confirmar._
- **3.1 Navegação por papel**, responsiva (grade no computador, lista no celular).
- **3.2 `apply_plan_changes_v1(jsonb)`:** `SECURITY INVOKER`, tudo ou nada, compare-and-set em `updated_at`. Necessária porque `moveVisitToDate` gera 2 mudanças atômicas e o PostgREST não tem transação.
- **3.3 Tela Dia:** por repositor, status, horários, último contato do aparelho, pendências e recusados; atualiza a cada 60 s.
- **3.4 Tela Semana:** `addVisit`, `reorderVisit`, `cancelVisit`, `moveVisitToDate` de `src/domain/plan.ts`, gravando por 3.2.
- **3.5 Remanejar sobras:** `not_done` de dias passados → `carryOver` ou `addVisit`; `reopenVisit` com a oferta de cancelar a cópia (`postponedCopy`).
- **3.6 Caixa de recusados:** `leader_apply_rejected_event_v1(event_id)` grava evento do líder que aponta o original; "aplicar", "aplicar todos do repositor/dia" e "descartar".
- **3.7 Histórico da visita:** linha do tempo com eventos e `audit_log`.
- **3.8 Ausências:** cancelar as visitas de um repositor entre duas datas (férias, feriado), para o job não gerar "não foi" em massa.
- **3.9 E2E do líder:** o segundo `test.fixme` de `e2e/critical-flows.spec.ts` vira teste real; entra "aplicar recusado".

### Marco 4: Cadastros e acesso

- **4.1 Migration:** `profiles.deactivated_at`, `profiles.email` (trigger a partir de `auth.users`), **auditoria em `profiles`** (hoje a troca de papel não é auditada), triggers "sempre resta um líder ativo" e "ninguém muda o próprio papel", checagem de usuário ativo nas policies.
- **4.2 Mercados:** listar, criar, editar, arquivar (oferece cancelar as visitas futuras).
- **4.3 Rota padrão:** editor repositor × dia; ao salvar, oferece aplicar às visitas já criadas (função pura nova no domínio: acrescenta o que falta e cancela as `planned` de origem `standard` que saíram da rota, de amanhã em diante).
- **4.4 Edge Functions** `users-admin` e `set-own-password` (seção abaixo); testes Deno; na CI o job de E2E deixa de excluir o `edge-runtime`.
- **4.5 Tela de usuários:** listar, criar (mostra a senha temporária uma vez), trocar papel, desativar/reativar, redefinir senha.
- **4.6 Primeiro acesso:** `must_change_password` força a troca; depois `refreshSession`. _Teste:_ E2E líder cria → usuário troca a senha → chega ao Hoje.

### Marco 5: Produção e endurecimento

- **5.1** Produção (Supabase Pro `sa-east-1`, config versionada, aprovação manual no deploy). **5.2** Release (tags, notas, como subir `min_client_version`, "só acrescentar agora, remover depois").
- **5.3 Performance:** 2 anos de dados sintéticos para 50 repositores; `EXPLAIN ANALYZE` de Hoje, Dia, Semana e audit como repositor e como líder (meta: < 50 ms).
- **5.4 Segurança:** matriz de RLS exaustiva em pgTAP (papel × tabela × operação), CSP e HSTS, Dependabot.
- **5.5 LGPD e jurídico:** aviso de privacidade com aceite, retenção do audit, exportação por titular, contratos com fornecedores, Sentry sem dado pessoal. **Validar com o jurídico que o app não é ponto eletrônico** (check-in/out com horário pode ser lido assim).
- **5.6 Acessibilidade** (axe em todo E2E; fonte grande e luz forte). **5.7 Runbooks** (job que não rodou, aparelho que perdeu pendências, restore, troca de chaves, desligamento de funcionário).
- **5.8 Piloto controlado:** 2–3 repositores por 1–2 semanas, com critério de seguir ou parar.

## Segurança da gestão de usuários (Edge Function)

- `verify_jwt = true`. Dentro, cliente com o `Authorization` recebido + `auth.getUser()`; **papel vem só de `profiles`**, nunca de `user_metadata`. O cliente admin (service role, injetada no ambiente hospedado) só é criado **depois** da autorização. Entrada validada com zod; CORS restrito.
- As regras ficam também no banco (4.1), não só na função.
- **Criar:** `createUser` com senha temporária gerada no servidor (12+ caracteres, alfabeto legível), `email_confirm: true`, `app_metadata.must_change_password`; mostrada uma vez ao líder. **Papel:** `UPDATE profiles` pelo cliente do líder (audita o ator certo). **Desativar:** `ban_duration` + `deactivated_at` (as policies checam usuário ativo, fechando a janela do token válido). **Redefinir:** nova senha temporária + flag; se não derrubar sessões, `revoke_user_sessions(uid)` só para a service role. **Trocar a própria senha:** `set-own-password`. **Primeiro líder:** `scripts/bootstrap-leader.ts` (runbook).
- Ações em `auth.users` são registradas por `log_admin_action(...)` (`SECURITY DEFINER`, só service role). Política de senha: mínimo 10 caracteres (hoje 6 em `config.toml`).
- **Testes Deno** com matriz de autorização: sem token 401; repositor 403; líder desativado 403; último líder recusado.

## Spikes (curtos, antes de comprometer o desenho)

| Spike                                      | Pergunta                                                                                                                                                                 | Decide                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| S1 Sessão offline (½–1 dia)                | Com o token vencido e sem rede, o que `getSession()` faz? A renovação ao voltar funciona? E se for revogada? Duas abas?                                                  | Identidade guardada; storage próprio da sessão                  |
| S2 Celular real (1–2 dias, depende de 0.4) | Service worker e IndexedDB sobrevivem a app encerrado, reinício e 3 dias? `persist()`? `online` é confiável no iOS? Safari e app instalado têm armazenamentos separados? | Instalação obrigatória no iOS; versão mínima; gatilhos de envio |
| S3 pg_cron (½ dia)                         | Funciona com migrations do zero, no `db lint` e no Supabase hospedado?                                                                                                   | pg_cron ou alternativa (Edge Function agendada / Actions)       |
| S5 Usuários (1 dia)                        | Redefinir senha pelo admin derruba sessões? Convite por e-mail exigiria SMTP?                                                                                            | Como derrubar sessões; se SMTP entra no MVP                     |
| S6 E2E com service worker (½ dia)          | `setOffline` afeta as requisições do service worker? `page.clock` adianta a expiração do token?                                                                          | Arquitetura do E2E do marco 1                                   |
| S7 Hospedagem (½ dia)                      | SPA fallback, `_headers` (`sw.js` sem cache, CSP), previews                                                                                                              | Cloudflare Pages ou Vercel                                      |

A RPC (1.2) vai direto como PR: o risco é de código e o pgTAP o cobre. O `pg_cron` não foi verificado nesta sessão (Docker parado).

## Pendências (não bloqueiam o início)

- **3.0:** confirmar que só o líder edita mercados e rota (a matriz atual deixa o repositor).
- **Fechamento D+1 03:00:** reavaliar a tolerância com os dados do protocolo de campo.
- **4.3:** aplicar mudança de rota às visitas já criadas, ligado por padrão ou não.
- **Relatório/exportação (CSV)** para o líder: fora do MVP, confirmar.
- Corrigir `index.html` (`lang="pt-BR"`, título de produto) junto de 0.3.

## Como começar (após aprovação)

Primeiros PRs, nesta ordem: **0.1** (README e ADRs), **0.2** (fuso), **0.3** (versão), em paralelo aos spikes **S1** e **S3** (não dependem de HTTPS). Depois **0.4** (homologação) e **S2**, que destravam o marco 1. O marco 1 começa por **1.1** (domínio) e **1.2** (migration), a base de tudo.

## Verificação end-to-end

- **Por PR:** `npm run verify`, build, pgTAP, `db:lint`, diff de tipos, E2E (como o CI); matriz de 4 fusos para código de data.
- **Offline:** teste de propriedade do motor de sincronização, pgTAP com casos compartilhados com o domínio, E2E com `setOffline`, e o **protocolo de campo (1.11) em Android e iPhone reais** na homologação.
- **Líder e cadastros:** E2E dos dois fluxos críticos; testes Deno da matriz de autorização.
- **Job diário:** pgTAP (idempotência, recuperação de noites perdidas) e a view de saúde na homologação.
- **Aceite do MVP:** (1) um repositor completa um dia inteiro sem sinal e ao reconectar tudo chega **uma vez só**, com conflitos explicados; (2) o líder planeja a semana, acompanha o dia e remaneja o que não foi feito, tudo no log; (3) o líder cadastra mercado, rota e usuário sem tocar no banco; (4) nenhuma visita fica "aberta" para sempre; (5) produção no ar com backup, monitoramento, runbooks e piloto aprovado.

## Arquivos críticos

`src/features/today/today-controller.ts`, `src/domain/sync.ts`, `src/domain/execution.ts`, `src/domain/status.ts`, `src/domain/plan.ts`, `src/domain/permissions.ts`, `src/features/auth/AuthProvider.tsx`, `src/lib/supabase/auth.ts`, `src/lib/supabase/repository.ts`, `src/features/today/clock.ts`, `supabase/migrations/20261020000000_init.sql` (referência: mudanças vão em migrations novas), `e2e/critical-flows.spec.ts`, `.github/workflows/ci.yml`.
