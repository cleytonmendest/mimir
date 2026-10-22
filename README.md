# Agenda de Degustações

App para **fornecedores** reservarem estandes de degustação nos mercados de um dono de supermercados, no dia que quiserem, e para o **administrador** (o dono) definir o limite de estandes por mercado e acompanhar a agenda. Se o dia está lotado, o sistema não deixa reservar. Tudo fica auditado.

> Nomes: o repositório é `mimir`, o pacote é `agenda-degustacoes` e o produto é "Agenda de Degustações".

**Estado atual:** o produto foi reposicionado (era a "rota do repositor"; ver [ADR 0005](docs/adr/0005-reserva-com-limite-garantido-no-banco.md)) e as funções do MVP estão prontas. O fornecedor vê as vagas por mercado e dia, reserva e cancela (o limite nunca é ultrapassado, nem com disputa pela última vaga). O administrador define o limite de cada mercado, fecha datas, vê quem reservou e cancela reservas; cadastra fornecedores (link de ativação para eles escolherem a senha), desativa quem não deve mais reservar e escolhe se a página de cadastro fica fechada, com código de convite ou livre ([ADR 0006](docs/adr/0006-acesso-por-link-de-ativacao-e-cadastro-configuravel.md)). O que falta (homologação, produção, SMTP, endurecimento e piloto) está em [`docs/mvp.md`](docs/mvp.md); o protótipo aprovado pelo dono, em [`docs/prototipo/`](docs/prototipo/agenda-degustacoes.html). As decisões de arquitetura estão em [`docs/adr/`](docs/adr) e a operação em [`docs/runbooks/`](docs/runbooks).

## Rodando localmente

Precisa de **Node 22.18+** (`.nvmrc`) e **Docker** (o Supabase local roda em contêineres).

```sh
npm ci
npm run db:start                      # sobe o Supabase local e aplica as migrations (leva alguns minutos na 1ª vez)
npx supabase status -o env            # mostra API_URL e ANON_KEY
cp .env.example .env.local            # e preencha VITE_SUPABASE_URL (API_URL) e VITE_SUPABASE_ANON_KEY (ANON_KEY)
npm run dev                           # http://localhost:5173
```

Não existe cadastro pelo navegador (`enable_signup = false`): as contas nascem nas Edge Functions. Para o primeiro administrador do seu ambiente local:

```sh
eval "$(npx supabase status -o env | sed 's/^/export /')"
SUPABASE_URL=$API_URL SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY \
  node scripts/bootstrap-admin.ts --email voce@teste.dev --nome "Você" --app-url http://localhost:5173
```

O script imprime um link: abra, escolha a senha e você já entra como administrador. Dali em diante, cadastre fornecedores pela aba Fornecedores. Em produção, veja o [runbook de acesso](docs/runbooks/acesso.md).

## Comandos

| Comando                              | O que faz                                                                                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run verify`                     | O que o CI roda antes do PR: lint, tipos, guards, testes com cobertura e Storybook                                                                   |
| `npm test` / `npm run test:coverage` | Testes (Vitest). O domínio exige **100% de cobertura**                                                                                               |
| `npm run test:tz`                    | Testes do domínio em 4 fusos horários (o CI roda a suíte inteira nesses fusos)                                                                       |
| `npm run e2e`                        | E2E no celular simulado (Playwright). Descobre o Supabase local sozinho; precisa de `npm run db:start` e de `npx playwright install chromium`        |
| `npm run db:test`                    | Testes do banco (pgTAP: RLS, auditoria, constraints, funções de reserva e de acesso)                                                                 |
| `npm run db:gen-cases`               | Regera o pgTAP das reservas (`70_booking_cases.test.sql`) a partir dos casos compartilhados com o domínio (`src/domain/fixtures/booking.cases.json`) |
| `npm run db:lint`                    | Lint do schema                                                                                                                                       |
| `npm run db:types`                   | Regera `src/lib/database.types.ts` (commitar a saída **crua**, sem formatar)                                                                         |
| `npm run storybook`                  | Vitrine do design system                                                                                                                             |

## Como o código é organizado

Camadas, de baixo para cima (o ESLint barra importar para cima):

1. `src/domain`: regras de negócio em TypeScript puro (sem React nem Supabase), 100% testadas. Quem pode o quê, o "dia" no fuso da empresa e as regras de reserva de estande (`booking.ts`), que o banco repete e os casos compartilhados provam iguais.
2. `src/design-system`: componentes visuais (shadcn/ui + Tailwind). Veja o [README do design system](src/design-system/README.md).
3. `src/lib`: integração com o mundo. **Único** lugar que importa o SDK do Supabase.
4. `src/features` e `src/App.tsx`: as telas.

O banco e as Edge Functions estão em `supabase/` (migrations, testes pgTAP, `functions/`). As funções só usam `fetch` (sem pacote externo); a lógica fica em `functions/_shared` e é testada no Vitest. O domínio e o banco falam do mesmo modelo; `src/domain/schema-sync.test.ts` quebra se um lado mudar sem o outro.

## Regras que o CI faz cumprir

- **Guards** (`npm run guard`): chave de servidor (`service_role`) nunca em `src/`; cor só em `tokens.css`; todo componente do design system tem story; toda tabela nova liga o RLS; teste desligado (`.skip`/`.only`) não passa; **migration já aplicada nunca é editada** (mudança de schema = migration nova).
- **Fuso:** o "dia" é o de Brasília, calculado pelo servidor, nunca o do aparelho ([ADR 0002](docs/adr/0002-fuso-da-empresa.md)).
- **Banco novo:** `supabase migration new nome`, depois `npm run db:test`, `npm run db:lint` e `npm run db:types`.

## Fluxo de trabalho

Tudo entra na `main` por PR com o check **`CI ok`** verde, em histórico linear (rebase ou squash). A proteção da branch está em `.github/rulesets/main.json`; `scripts/apply-branch-protection.sh solo|team` escolhe se exige aprovação de code owner (`team`) ou só o CI (`solo`).
