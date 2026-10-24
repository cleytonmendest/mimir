# Agenda de Degustações

App para **fornecedores** reservarem estandes de degustação nos mercados de um dono de supermercados, no dia que quiserem, e para o **administrador** (o dono) definir o limite de estandes por mercado e acompanhar a agenda. Se o dia está lotado, o sistema não deixa reservar. Tudo fica auditado.

> Nomes: o repositório é `mimir`, o pacote é `agenda-degustacoes` e o produto é "Agenda de Degustações".

**Estado atual:** o produto foi reposicionado (era a "rota do repositor"; ver [ADR 0005](docs/adr/0005-reserva-com-limite-garantido-no-banco.md)) e as funções do MVP estão prontas. O fornecedor vê as vagas por mercado e dia, reserva e cancela (o limite nunca é ultrapassado, nem com disputa pela última vaga). O administrador define o limite de cada mercado, fecha datas, vê quem reservou e cancela reservas; cadastra fornecedores (link de ativação para eles escolherem a senha), desativa quem não deve mais reservar e escolhe se a página de cadastro fica fechada, com código de convite ou livre ([ADR 0006](docs/adr/0006-acesso-por-link-de-ativacao-e-cadastro-configuravel.md)). O que falta (homologação, produção, SMTP, endurecimento e piloto) está em [`docs/mvp.md`](docs/mvp.md); o protótipo aprovado pelo dono, em [`docs/prototipo/`](docs/prototipo/agenda-degustacoes.html). As decisões de arquitetura estão em [`docs/adr/`](docs/adr) e a operação em [`docs/runbooks/`](docs/runbooks).

## Rodando localmente

Precisa de **Node 22.18+** (`.nvmrc`) e **Docker aberto** (o Supabase local roda em contêineres). Nada mais: sem criar arquivo, sem copiar chave.

```sh
npm ci
npm run dev:local        # sobe o banco, cria os dados de teste e abre o app em http://localhost:5173
```

Na primeira vez o Docker baixa as imagens e leva alguns minutos. O `dev:local` faz quatro coisas, que também dá para rodar separadas: `npm run db:start` (sobe o Supabase local: banco, login, API e Edge Functions), `npm run db:migrate` (aplica as migrations que o seu banco ainda não tem, sem apagar nada), `npm run db:seed-dev` (os dados de teste, abaixo, e o `.env.local` que o app precisa) e `npm run dev` (o Vite).

Depois de um `git pull` é só rodar o `npm run dev:local` de novo: o `db:start` não atualiza um banco que já estava rodando, e é o `db:migrate` que traz as migrations novas. Se o seed reclamar que uma coluna ou tabela "não existe", é o banco atrás das migrations: rode `npm run db:migrate`, e se não resolver, `npx supabase db reset` recria o banco do zero (ele só tem dados de teste). O servidor de login só lê o `supabase/config.toml` quando o contêiner é criado, e nem o `db reset` nem o `db:start` recriam um que já estava rodando. Por isso, depois de um `git pull` que muda o `config.toml`, e num Supabase local criado numa versão antiga do projeto (o primeiro commit tinha o login por e-mail desligado), o login pode seguir falhando: o navegador mostra `422` em `auth/v1/token` e o app diz "Não foi possível entrar". O seed detecta isso e avisa; a cura é `npx supabase stop` e depois `npm run dev:local` (os dados ficam).

### Dados de teste (o seed)

O Supabase do `db:start` é um banco só seu, dentro do Docker: mexer nele não toca em nenhum banco de verdade. `npm run db:seed-dev` o enche de dados fictícios:

| Quem                  | E-mail                                                | Senha        |
| --------------------- | ----------------------------------------------------- | ------------ |
| Administrador         | `admin@admin.com`                                     | `admin12345` |
| Fornecedores          | `fornecedor1@example.com` a `fornecedor8@example.com` | `senha12345` |
| Fornecedor desativado | `fornecedor9@example.com`                             | `senha12345` |

Vêm junto as **31 lojas reais da rede Zona Sul** (de `Loja 01 - Ipanema` a `Loja 48 - Recreio`, com o endereço de cada uma), as 31 que aparecem na [lista oficial de unidades](https://novosite.zonasul.com.br/api/bff/sellers) em 23/10/2026; a Loja 34, que está inativa lá, ficou de fora. Os nomes e endereços são os do site, mas **os limites de estandes são inventados** (de 2 a 5 por loja, definidos pelo número da loja), assim como as contas e as reservas. As reservas e as datas fechadas ficam a partir de hoje, nas lojas 07 (Leblon), 01 (Ipanema), 36 (Arnaldo Quintela) e 17 (Barra da Tijuca), com dia lotado, dia com vaga, reserva cancelada e a conta desativada, para ver cada situação das telas. Com 31 lojas na lista, é a **busca por bairro ou nome** que faz a tela de reservar, a agenda e a lista de mercados do administrador ficarem fáceis de usar: digitar `leblon`, `gavea` ou `loja 36` já filtra, sem ligar para acento nem caixa, e todas as palavras digitadas precisam aparecer no nome ou no endereço. Rodar de novo é seguro: reaproveita as contas e as lojas, refaz as reservas e as datas fechadas (útil quando os dias do seed ficam para trás) e apaga os 4 mercados fictícios das versões antigas do seed (`Mercado Central` e companhia), se ainda existirem. `npx supabase db reset` apaga tudo; rode o seed outra vez depois.

Essas senhas são públicas (estão no código), então o seed **só roda contra o Supabase local**: ele recusa qualquer outro endereço e qualquer chave de serviço que não seja a do Supabase local, antes de escrever qualquer coisa.

O seed também deixa o `.env.local` apontando para o Supabase local: cria o arquivo se faltar e corrige se as variáveis estiverem vazias (é o que acontece com uma cópia do `.env.example`) ou apontando para outro lugar, avisando para onde apontava. Se o app abrir pedindo `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`, rode `npm run dev:local` de novo. O Vite só lê o `.env.local` quando inicia, então um dev server que já estava rodando não pega a correção: o `dev:local` usa a porta 5173 e para com "Port 5173 is already in use" se ela estiver ocupada por um servidor antigo. Feche esse (Ctrl+C no terminal dele) e rode de novo.

Em produção o primeiro administrador nasce de outro caminho (nunca o seed): veja o [runbook de acesso](docs/runbooks/acesso.md).

## Comandos

| Comando                              | O que faz                                                                                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev:local`                  | Tudo para rodar na sua máquina: sobe o Supabase local, cria os dados de teste (`db:seed-dev`) e abre o app                                           |
| `npm run verify`                     | O que o CI roda antes do PR: lint, tipos, guards, testes com cobertura e Storybook                                                                   |
| `npm test` / `npm run test:coverage` | Testes (Vitest). O domínio exige **100% de cobertura**                                                                                               |
| `npm run test:tz`                    | Testes do domínio em 4 fusos horários (o CI roda a suíte inteira nesses fusos)                                                                       |
| `npm run e2e`                        | E2E no celular simulado (Playwright). Descobre o Supabase local sozinho; precisa de `npm run db:start` e de `npx playwright install chromium`        |
| `npm run db:migrate`                 | Aplica ao banco local as migrations que ele ainda não tem (sem apagar dados). O `dev:local` já faz isso                                              |
| `npm run db:test`                    | Testes do banco (pgTAP: RLS, auditoria, constraints, funções de reserva e de acesso)                                                                 |
| `npm run db:gen-cases`               | Regera o pgTAP das reservas (`70_booking_cases.test.sql`) a partir dos casos compartilhados com o domínio (`src/domain/fixtures/booking.cases.json`) |
| `npm run db:seed-dev`                | Dados de mentira no Supabase local (`admin@admin.com`, fornecedores, mercados, reservas). Recusa qualquer banco que não seja o local                 |
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
