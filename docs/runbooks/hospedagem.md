# Runbook: hospedagem do app (Netlify)

O app é só arquivos estáticos (`npm run build` gera o `dist/`). Banco, login e Edge Functions ficam no Supabase (ver [acesso](acesso.md) para a configuração dele); o Netlify serve o front. Tudo o que o Netlify precisa saber está no [`netlify.toml`](../../netlify.toml).

## Primeira vez

1. Netlify → **Add new site → Import an existing project** → escolha o repositório. O build (`npm run build`) e a pasta (`dist`) já vêm do `netlify.toml`; o Node vem do `.nvmrc`.
2. Em **Site configuration → Environment variables**, crie as duas variáveis do ambiente:

   | Variável                 | Valor                                                                             |
   | ------------------------ | --------------------------------------------------------------------------------- |
   | `VITE_SUPABASE_URL`      | `https://<projeto>.supabase.co`                                                   |
   | `VITE_SUPABASE_ANON_KEY` | a chave **pública** (anon/publishable) do projeto, em Project Settings → API Keys |

   A chave de serviço **nunca** entra aqui (nem com outro nome): o que o Vite lê vira texto no JavaScript que o navegador baixa.

3. **Deploy**. Abra o endereço `https://<site>.netlify.app` e entre.

Um site por ambiente (homologação e produção), cada um com o Supabase dele. Em produção, ligue a aprovação manual (**Deploys → Stop auto publishing**) para publicar só depois de conferir o deploy.

## Se o build falhar com "secrets scanning"

O Netlify procura nos arquivos do build valores que pareçam segredos. A chave anon do Supabase é pública e vai mesmo dentro do JavaScript, então ela pode ser apontada. Isso é um falso positivo: em **Environment variables** crie `SECRETS_SCAN_SMART_DETECTION_OMIT_VALUES` com o valor da chave anon (várias, separadas por vírgula) e faça **Deploy project** de novo. Prefira isso a desligar a varredura do site inteiro. Chave de serviço ou qualquer outro segredo aparecendo no build **não** é falso positivo: tire-o do front.

## O que o `netlify.toml` faz

- **SPA:** qualquer endereço que não seja um arquivo (`/cadastro`, `/definir-senha`) devolve o `index.html`. Sem isso, recarregar a página dá 404.
- **Cache:** `/assets/*` (com hash no nome) fica em cache por um ano; o `index.html` sempre é revalidado, então uma versão nova aparece no próximo carregamento.
- **Cabeçalhos de segurança:** HSTS, `nosniff`, sem iframe, sem `Referer` (o link de ativação leva o token na URL) e CSP. O CSP só deixa o app falar com ele mesmo e com `https://*.supabase.co`.

Ao ligar o **Sentry** (H.2) ou o **Turnstile** (modo Livre), o navegador passa a falar com mais um endereço: acrescente-o em `connect-src` (e, no Turnstile, em `script-src` e `frame-src`) no `netlify.toml`. O sintoma de esquecer é a função ficar muda e o console do navegador mostrar `Refused to connect... Content Security Policy`. Se o Supabase ganhar domínio próprio, troque o `*.supabase.co` por ele.

## Depois de publicar

- **Supabase → Authentication → URL Configuration:** ponha o endereço final em **Site URL**. Os links de ativação em si não dependem disso (o app os monta com o endereço de onde o administrador está), mas os e-mails do Supabase (confirmação do modo Livre, "esqueci a senha") usam o Site URL.
- **Primeiro administrador:** `scripts/bootstrap-admin.ts` com `--app-url https://<endereço do app>` (veja o [runbook de acesso](acesso.md)).
- **Gere os links de ativação pelo endereço de produção**, não por um preview: o link aponta para o endereço aberto na hora, e o de um preview leva o fornecedor para o preview.
- **Domínio próprio:** Domain management → Add a domain. O HTTPS é emitido sozinho. Depois, atualize o Site URL do Supabase.

## Quando algo dá errado

| Sintoma                                               | O que fazer                                                                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| O app abre pedindo `VITE_SUPABASE_URL`                | As variáveis não existem no site ou foram criadas depois do build: crie e rode **Deploy project** (elas são lidas na hora do build). |
| Tela em branco e `Content Security Policy` no console | O app tentou falar com um endereço fora do CSP: acrescente-o no `netlify.toml` (acima).                                              |
| Versão ruim no ar                                     | **Deploys** → abra um deploy antigo bom → **Publish deploy**. Volta na hora, sem novo build.                                         |
| Trocou a chave anon no Supabase                       | Atualize `VITE_SUPABASE_ANON_KEY` e rode **Deploy project** (veja a troca de chaves em [operação](operacao.md)).                     |
