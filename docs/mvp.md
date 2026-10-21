# Plano do MVP: Agenda de Degustações

> Reescrito em 21/10/2026, depois de o dono dos mercados aprovar o protótipo ([`docs/prototipo/agenda-degustacoes.html`](prototipo/agenda-degustacoes.html), abre direto no navegador). Substitui o plano da "rota do repositor", que partia de um problema que não era o do cliente (ele continua no histórico do git, no commit `cbfe944`). As decisões de arquitetura estão em [`docs/adr/`](adr). Atualize este plano quando uma decisão mudar.

## Contexto

Um dono de vários supermercados tem fornecedores que querem montar estandes de degustação nos mercados. Cada mercado aceita um número limitado de estandes por dia (por exemplo, 3). O dono não quer organizar isso: os próprios fornecedores escolhem o mercado e o dia e, se houver vaga, reservam; se não houver, o sistema não deixa.

O produto é uma aplicação web, para celular e computador, com dois papéis: o **fornecedor** reserva e cancela; o **dono** (papel `admin`, "Administrador" na tela) define os limites, fecha datas, cadastra fornecedores e consulta a agenda. Tudo fica auditado.

**Não há mais offline.** Uma vaga só existe se o servidor confirma na hora, então reservar exige internet. Isso elimina o maior risco do plano anterior (fila no aparelho, sincronização, service worker). O risco que sobra é de regra de negócio e de acesso: o limite nunca pode ser ultrapassado, mesmo com dois fornecedores clicando na última vaga ao mesmo tempo, e o cadastro de fornecedores não pode virar porta aberta.

## O que o dono aprovou (decisões fixas)

1. **Limite de estandes por dia, por mercado**, definido pelo dono. Vale para todos os dias do mercado.
2. **O estande ocupa o dia inteiro.** Não há horários.
3. **A reserva vale na hora.** O dono não aprova nada.
4. **Dá para reservar de amanhã até 60 dias à frente.**
5. **O fornecedor cancela quando quiser** (até o dia do estande) e a vaga volta para os outros.
6. **O fornecedor vê só quantas vagas restam.** Só o dono vê quem reservou.
7. **O dono fecha datas** (feriado, inventário). Reservas já feitas continuam valendo; só não entram novas.
8. **Um fuso só:** horário de Brasília. O "dia" é calculado pelo servidor, não pelo aparelho (ADR 0002).
9. **Login por e-mail e senha.** Nenhum usuário real antes do piloto controlado; antes dele, só homologação privada.
10. **Cadastro de fornecedores:** o administrador cadastra sempre, pelo painel. Existe também uma página pública de cadastro, e em Configurações ele escolhe o modo: **Fechado** (padrão), **Com código de convite** ou **Livre**. Detalhes em "Acesso".

## Decisões em aberto

Nenhuma bloqueia os blocos 1 a 3. Cada uma diz o que bloqueia e a recomendação. (A D1, quem pode ser fornecedor, está decidida: ver "Acesso".)

| #   | Pergunta                                                                                                                                                                                           | Bloqueia   | Recomendação                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| D2  | **Provedor de e-mail** (SMTP). Só o modo Livre (confirmar o e-mail) e o "esqueci a senha" feito pelo próprio fornecedor precisam dele. Antes disso, o administrador gera um novo link de ativação. | Modo Livre | Provedor com plano gratuito (por exemplo Resend), com uma conta e um domínio para o remetente.                                           |
| D3  | **Freio do dono:** cancelar uma reserva e desativar um fornecedor. Não estava no protótipo, mas sem isso um abuso só se resolve mexendo no banco.                                                  | Bloco 4    | Incluir, com motivo e auditoria. É pequeno.                                                                                              |
| D4  | **Limite de reservas ativas por fornecedor.** Hoje um fornecedor pode reservar um estande em cada mercado, em cada dia, nos 60 dias.                                                               | Piloto     | Sem limite no MVP, com a contagem visível ao dono. Como há uma única porta de escrita (a RPC), ligar o limite depois é mudar uma função. |
| D5  | **Avisos por e-mail** (confirmação e cancelamento ao fornecedor; agenda do dia para a loja).                                                                                                       | Pós-MVP    | Fora do MVP. A loja precisa saber quem chega? Se sim, uma "agenda do dia" por mercado vem logo depois do piloto.                         |
| D6  | **Um fornecedor, um login.** Vários usuários por empresa (vários promotores) ficam fora do MVP.                                                                                                    | Pós-MVP    | Confirmar com o dono.                                                                                                                    |

## O que muda no repositório

A fundação fica; o domínio de rota e todo o offline saem. Nada foi para produção, então não há dado a migrar.

| Fica                                                                                                                                                                                                                                                                                                                     | Adapta                                                                                                                                                                                                                                                                                                          | Sai                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CI com `CI ok`, guards, ruleset, pgTAP, Playwright contra o Supabase local, Storybook, Vitest e `fast-check`. Fuso (`dates.ts`, `company_date()`, ADR 0002). Cliente e login do Supabase (`src/lib/supabase/client.ts`, `auth.ts`, `src/features/auth`). Auditoria (`audit_log`, triggers, `app.source`). Versão do app. | `markets` (ganha o limite). `profiles` (papéis `admin` e `supplier`, nome da empresa). `permissions.ts` e a matriz de RLS. `tokens.css` (paleta e fontes do protótipo). O padrão de casos compartilhados domínio ↔ pgTAP e o do teste de concorrência (voltam no Bloco 2 com as reservas). ADR 0004 (retenção). | `src/domain` de visitas (`carryover`, `execution`, `plan`, `projection`, `status`, `sync`, `week`, `audit`, `keys` e as fixtures). `src/features/today`. `src/lib/supabase` de visitas (`repository`, `mappers`, `visits-gateway`, `sync-gateway`, `sync-wire`). `StatusBadge`. Tabelas `visits`, `visit_events`, `standard_route`, `device_status`, a RPC `sync_visit_events_v1` e `app_config.min_client_version`. ADRs 0001 e 0003 (viram "substituído"). |

O código do offline que não chegou à `main` (fatias 1.4 a 1.7: armazenamento local, motor de sincronização, login offline e tela Hoje offline) ficou no PR #6, fechado sem merge. Serve de referência, não entra no produto.

## Desenho

### Dados

- **`markets`** (já existe): ganha `capacity` (inteiro, 1 a 20, padrão 3). `archived_at` continua marcando o mercado inativo.
- **`closed_days`** (nova): `market_id`, `day` (`date`), `reason` opcional. Chave primária `(market_id, day)`.
- **`bookings`** (nova): `id`, `market_id`, `day` (`date`), `supplier_id` (→ `profiles`), `created_at`, `cancelled_at`, `cancelled_by`. Índice único parcial `(market_id, day, supplier_id) where cancelled_at is null` (um fornecedor não reserva duas vezes o mesmo dia no mesmo mercado) e índice `(market_id, day) where cancelled_at is null` para a contagem.
- **`profiles`**: papel `admin` ou `supplier`, `company_name`, `email` (copiado de `auth.users` por trigger) e `deactivated_at`.
- **Janela de reserva** (60 dias, a partir de amanhã): constante no domínio e valor em `app_config`, com teste que confere os dois.
- Datas são `date`, sem hora. "Hoje" é `company_date(now())` no servidor, e a RPC de disponibilidade devolve esse dia para a tela desenhar a janela certa.

### Reservar (o servidor decide)

`book_slot_v1(p_market, p_day)`, `SECURITY DEFINER`, `search_path = ''`:

1. Confere que quem chama é um fornecedor ativo.
2. **Trava o par mercado e dia** (`pg_advisory_xact_lock`), então duas reservas do mesmo dia se enfileiram.
3. Reavalia tudo: mercado ativo, dia dentro da janela, dia não fechado, fornecedor ainda sem reserva ali, vagas restantes.
4. Insere e devolve `{ok, booking_id}` ou `{ok: false, code}`, com a contagem atual.

Vocabulário único de recusa, igual no TypeScript e no SQL: `FULL`, `CLOSED`, `OUT_OF_WINDOW`, `MARKET_INACTIVE`, `FORBIDDEN`. Reservar de novo o que já é seu (clique duplo, repetição de rede) devolve sucesso com a mesma reserva, então repetir é seguro. O app lê um código desconhecido como `UNRECOGNIZED`, sem quebrar.

`cancel_booking_v1(p_booking)`: do próprio fornecedor (ou do dono), só de hoje em diante, idempotente.

`market_availability_v1(p_market, p_from, p_to)`: devolve `today` e, por dia, `capacity`, `booked`, `closed` e `mine`. **Só contagens**, nunca nomes.

### O limite nunca é ultrapassado: três camadas

1. **A RPC** com a trava e a reavaliação acima.
2. **Um trigger de guarda** em `bookings` (mesmo padrão do antigo `guard_visit_update`): antes de inserir, pega a mesma trava e recusa se a contagem já chegou ao limite. Assim um erro futuro em uma função, ou um insert feito por um script, não consegue passar do limite.
3. **Testes**: concorrência real (N chamadas simultâneas para a última vaga resultam em exatamente `capacity` reservas) e teste de modelo com `fast-check` (qualquer sequência de reservar, cancelar, mudar o limite e fechar dias nunca faz uma _nova_ reserva passar do limite).

O dono pode reduzir o limite abaixo de dias já reservados: as reservas existentes ficam como estão e só as novas respeitam o limite novo. A tela avisa.

### Leitura e privacidade

- RLS: o fornecedor lê só as próprias reservas; o dono lê todas, com os nomes. `markets` e `closed_days` são legíveis por quem está logado. Clientes **não escrevem** em `bookings`: só pelas RPCs. `markets` e `closed_days` só o dono altera.
- A tela pode estar desatualizada: se o servidor recusa com `FULL`, a tela consulta de novo e explica ("acabou de lotar"). Atualiza ao abrir, ao voltar para a aba e depois de cada ação. Sem tempo real no MVP.
- O fornecedor nunca recebe nome de outro fornecedor, nem pela RPC, nem por RLS. O pgTAP prova os dois caminhos.

### Auditoria

Triggers de auditoria em `bookings`, `markets`, `closed_days` e `profiles` (hoje a troca de papel não deixa rastro). No update só a diferença (`changes`), como no ADR 0004. O ator é sempre `auth.uid()`.

### Acesso: cadastro de fornecedores

**O administrador cadastra sempre.** Além disso existe a página pública `/cadastro`, e em Configurações o administrador escolhe o modo: **Fechado** (padrão: ninguém cria conta por ela), **Com código de convite** ou **Livre** (qualquer pessoa com e-mail e senha; exige confirmação de e-mail).

- **Cadastro pelo administrador:** na tela Fornecedores ele informa empresa e e-mail. O sistema cria a conta e devolve um **link de ativação** (24 h, uso único) para ele copiar ou enviar pelo WhatsApp; o fornecedor define a própria senha. Nenhuma senha passa pelo administrador. Perdeu o acesso: novo link.
- **Código de convite:** 8 caracteres legíveis (sem `0/O/1/I`), visível só ao administrador, com "Copiar link de convite" (`/cadastro?codigo=…`), "Compartilhar" e "Gerar novo código" (invalida o anterior; contas já criadas continuam). O sistema não envia e-mail nesse caminho.
- **Implementação:** Edge Functions, as únicas com a chave de serviço (nunca em `src/`, guard existente). `admin-create-supplier` e `admin-supplier-link` (`verify_jwt`, conferem em `profiles` que quem chama é admin ativo; o link vem de `auth.admin.generateLink`, que não envia e-mail). `public-signup` e `signup-status` (sem JWT): leem a configuração, validam o código em tempo constante, limitam tentativas por IP e por e-mail e criam a conta com papel `supplier`. O Auth continua com `enable_signup = false` (já está no `config.toml`): nenhuma conta nasce pelo SDK do navegador.
- **Configuração** em `signup_settings` (uma linha: `mode`, `invite_code`), com RLS só para admin. Não vai em `app_config`, que todo usuário logado lê. `handle_new_user` fixa o papel `supplier`: papel nunca vem do cliente. O primeiro admin nasce de `scripts/bootstrap-admin.ts`.
- **SMTP fora do caminho crítico:** só o modo Livre e o "esqueci a senha" do próprio fornecedor dependem dele. O modo Livre também leva Cloudflare Turnstile e limite de tentativas. A política de senha sobe de 6 para 10 caracteres.

## Blocos (cada um, um PR; fatias são commits)

Tamanhos relativos (P/M/G), não prazos. Um bloco que passar de uns 3 mil linhas vira dois PRs.

| #   | Bloco                            | Entrega                                                               | Tam. | Depende de      |
| --- | -------------------------------- | --------------------------------------------------------------------- | ---- | --------------- |
| 1   | Limpeza e reposicionamento       | `main` sem visitas e sem offline; login por papel; nome do produto    | M    | nada            |
| H   | Homologação                      | Ambiente HTTPS privado e Sentry (em paralelo aos blocos 2 a 5)        | M    | contas externas |
| 2   | Regras e banco                   | Domínio, schema, RLS, RPCs, trigger de guarda, testes de concorrência | G    | 1               |
| 3   | Fornecedor                       | Identidade visual, reservar, minhas reservas, E2E                     | G    | 2               |
| 4   | Dono                             | Mercados e limites, datas fechadas, agenda, freio                     | M    | 2, D3           |
| 5   | Acesso                           | Fornecedores e link de ativação, cadastro por código, modo Livre      | M    | S-A             |
| 6   | Produção, endurecimento e piloto | Produção, segurança, LGPD, acessibilidade, runbooks, piloto           | M    | todos           |

### Bloco 1: Limpeza e reposicionamento

- **1.1 Remover o domínio e as telas de rota** (lista acima) e seus testes. `types.ts`, `errors.ts`, `index.ts` e `permissions.ts` passam a falar de `admin` e `supplier`.
- **1.2 Migration de reposicionamento:** derruba `visits`, `visit_events`, `standard_route`, `device_status`, as funções de sincronização e os tipos de visita; troca `user_role` para `admin` e `supplier`; remove `min_client_version`. Migrations continuam imutáveis (é uma migration nova). Reescreve `00_structure`, `20_profiles_and_anon` e `30_audit`; apaga os pgTAP de visitas e de sincronização, o gerador de casos de sincronização (com o teste dele) e `e2e/sync-concurrency.spec.ts`; os dois padrões voltam no Bloco 2.
- **1.3 App por papel:** `App.tsx` mostra um espaço para o dono e outro para o fornecedor (vazios por enquanto); `package.json`, `index.html`, README e `AccountBar` com o nome do produto. Seed: 1 dono, 2 fornecedores, 3 mercados. E2E de login nos dois papéis.
- **1.4 ADRs:** 0001 e 0003 marcados como substituídos; novo **ADR 0005** "Reserva com limite garantido no banco" (trava, trigger, RPC, leitura por contagens, sem offline).
- _Pronto quando:_ `npm run verify`, pgTAP, E2E e CI verdes, e nenhuma menção a visita ou offline fora dos ADRs antigos.

### Bloco H: Homologação (em paralelo)

Precisa das contas do dono do projeto: Supabase em `sa-east-1` e hospedagem (Cloudflare Pages ou Vercel, spike S-B). Sem service worker, é uma implantação comum.

- **H.1 Homologação HTTPS:** `deploy-homolog.yml` (`supabase db push`, build, varredura do `dist/` com os padrões do guard de service role, deploy), `site_url` e redirects, seed de homologação fora de `src`. _Pronto:_ o dono abre o link no celular dele.
- **H.2 Sentry:** com `release`, sem dado pessoal, e um ErrorBoundary.

### Bloco 2: Regras e banco

- **2.1 Domínio (puro, 100% de cobertura):** `booking.ts` com a avaliação de reserva, a disponibilidade por dia e a regra de cancelamento; os códigos de recusa; casos compartilhados em `src/domain/fixtures/booking.cases.json`; teste de modelo com `fast-check`. _Teste:_ matriz de 4 fusos para a virada do dia.
- **2.2 Migration do schema:** `capacity`, `closed_days`, `bookings`, `profiles`, RLS, auditoria, índices e revogações. _Teste:_ pgTAP de estrutura, RLS (fornecedor não lê reserva alheia, não escreve direto, anônimo não vê nada) e auditoria.
- **2.3 RPCs e trigger de guarda:** `book_slot_v1`, `cancel_booking_v1`, `market_availability_v1`. Um gerador (no mesmo padrão do que existia para a sincronização) escreve o pgTAP a partir do JSON de 2.1, com teste do Vitest que confere se está atualizado.
- **2.4 Camada de dados:** `src/lib/supabase/booking-gateway.ts`, que valida o que vem do banco e distingue rede, servidor e recusa. _Teste:_ unidade, e API do Playwright com dez chamadas simultâneas para a última vaga (uma vence) e para um limite de 3 (exatamente 3).

### Bloco 3: Fornecedor

- **3.1 Identidade visual no design system:** `tokens.css` com a paleta e as fontes do protótipo (claro e escuro); componentes com story: `SlotMeter` (os traços), `AvailabilityCalendar`, `MarketCard`, `Toast`.
- **3.2 Tela Reservar:** mercado, calendário do mês, painel do dia, confirmação. Mensagens de recusa em português; reconsulta automática depois de uma recusa. Controlador puro com o gateway injetado (o padrão que já usamos).
- **3.3 Minhas reservas:** lista, "ver no calendário" e cancelar com confirmação.
- **3.4 E2E:** reservar e cancelar; **dois navegadores disputando a última vaga** (um ganha, o outro vê "lotado" e nenhuma reserva a mais aparece); dia fechado; o fornecedor não vê nomes.

### Bloco 4: Dono

- **4.1 Mercados:** listar, criar, editar, arquivar e definir o limite (1 a 20), com aviso ao reduzir abaixo de dias já reservados.
- **4.2 Datas fechadas:** fechar e liberar um dia por mercado.
- **4.3 Agenda:** calendário com os nomes das empresas e as próximas reservas de todos os mercados, filtrável por mercado e por fornecedor.
- **4.4 Freio (D3):** cancelar uma reserva com motivo e desativar um fornecedor, tudo auditado.
- **4.5 E2E:** o dono muda o limite e o fornecedor vê o novo; fecha um dia; vê quem reservou.

### Bloco 5: Acesso

- **5.1 Migration:** `profiles.company_name`, `email`, `deactivated_at`; policies que checam usuário ativo; triggers "sempre resta um admin ativo" e "ninguém muda o próprio papel"; `signup_settings` (RLS só admin) e `signup_attempts`; auditoria de `profiles`.
- **5.2 Spike S-A e Edge Functions de admin** (`admin-create-supplier`, `admin-supplier-link`), com testes Deno (sem token 401; fornecedor 403; admin desativado 403). O `edge-runtime` volta ao job de E2E, hoje excluído do `supabase start` em `.github/workflows/ci.yml`.
- **5.3 Telas:** Fornecedores (listar, cadastrar, link de ativação, desativar e reativar) e a tela "defina sua senha" do primeiro acesso.
- **5.4 Configurações do cadastro e `/cadastro`:** modos Fechado e Com código (`public-signup`, `signup-status`, limite de tentativas).
- **5.5 Primeiro admin:** `scripts/bootstrap-admin.ts` e o runbook.
- **5.6 Modo Livre:** confirmação de e-mail (D2), Turnstile, "esqueci a senha" pelo próprio fornecedor, senha de 10 caracteres.
- **5.7 E2E:** o admin cadastra, o fornecedor ativa pelo link e reserva; código válido e inválido; modo Fechado recusa; fornecedor desativado não entra.

### Bloco 6: Produção, endurecimento e piloto

- **6.1 Produção:** Supabase Pro em `sa-east-1`, configuração versionada, aprovação manual no deploy; tags e notas de release.
- **6.2 Segurança:** matriz de RLS exaustiva em pgTAP (papel × tabela × operação), CSP e HSTS, Dependabot, revisão do cadastro contra abuso.
- **6.3 LGPD e jurídico:** aviso de privacidade com aceite (guardamos e-mail e nome da empresa), retenção do log (ADR 0004, a decidir antes da produção), exportação e exclusão por titular, contratos com Supabase, hospedagem, Sentry e e-mail.
- **6.4 Performance:** carga sintética (50 mercados, 60 dias, 500 fornecedores) com `EXPLAIN ANALYZE` da disponibilidade e da agenda (meta: menos de 50 ms).
- **6.5 Acessibilidade:** axe no E2E, calendário navegável por teclado, contraste nos dois temas.
- **6.6 Runbooks:** fornecedor que não consegue entrar, reserva indevida, restore, troca de chaves, mercado fechado de última hora.
- **6.7 Piloto controlado:** 1 ou 2 mercados e 3 a 5 fornecedores por 2 semanas. _Seguir se:_ nenhuma reserva acima do limite, os fornecedores reservam sem ajuda e o dono não precisou intervir além de limites e datas fechadas.

## Spikes (curtos, antes de comprometer o desenho)

| Spike                        | Pergunta                                                                                                                                                                                         | Decide                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| S-A Cadastro e links (1 dia) | `generateLink` funciona sem SMTP no Supabase local e no hospedado? Como a sessão chega ao app pelo link (fragmento ou PKCE) e qual tela de senha ele exige? O `edge-runtime` cabe no job de E2E? | O fluxo do link de ativação; o custo do E2E |
| S-B Hospedagem (½ dia)       | Cloudflare Pages ou Vercel: SPA fallback, cabeçalhos (CSP), previews                                                                                                                             | Onde a homologação roda                     |

Os spikes do plano anterior (sessão offline, celular real, `pg_cron`, E2E com service worker) deixam de ser necessários: não há offline nem job diário.

## Verificação

- **Por PR:** `npm run verify`, build, pgTAP, `db:lint`, diff de tipos e E2E, como no CI. Código de data passa na matriz de 4 fusos.
- **Limite:** teste de concorrência no banco, teste de modelo no domínio e E2E com dois navegadores.
- **Privacidade:** pgTAP prova que o fornecedor não lê reserva alheia, por tabela e por RPC.
- **Aceite do MVP:** (1) o fornecedor reserva e cancela pelo celular; (2) com vários fornecedores disputando a última vaga, o limite é respeitado em todos os casos; (3) o dono define limites, fecha datas e vê a agenda sem ajuda de quem desenvolveu; (4) nenhum fornecedor vê dado de outro; (5) tudo fica no log; (6) produção no ar com backup, monitoramento, runbooks e piloto aprovado.

## Como começar

O **Bloco 1** começa já, sem depender de ninguém. Em paralelo, pedir ao dono do projeto as contas de homologação (Supabase `sa-east-1` e hospedagem), para o Bloco H andar junto. D3 precisa de resposta antes do Bloco 4; o spike S-A abre o Bloco 5; o provedor de e-mail (D2) só entra com o modo Livre.

## Arquivos críticos

`supabase/migrations/` (mudanças vão em migrations novas), `src/domain/booking.ts`, `src/domain/permissions.ts`, `src/lib/supabase/booking-gateway.ts`, `src/features/booking/`, `src/design-system/tokens.css`, `e2e/`, `.github/workflows/ci.yml`.
