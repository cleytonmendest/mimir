# Runbook: acesso e cadastro de fornecedores

Para quem implanta e opera. O administrador do dia a dia só usa as abas **Fornecedores** e **Configurações** do app.

## Configuração obrigatória em cada ambiente

No projeto Supabase hospedado (o `supabase/config.toml` só vale para o local):

| Onde                                                                | Valor                                                                                       | Por quê                                                                                       |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Authentication → Sign In / Providers → "Allow new users to sign up" | **desligado**                                                                               | Nenhuma conta nasce pelo navegador; só as Edge Functions criam.                               |
| Authentication → Providers → Email → "Email OTP Expiration"         | **86400** (24 h)                                                                            | É a validade do link de ativação. O padrão (1 h) deixaria o link vencer antes de ser usado.   |
| Authentication → Password → mínimo                                  | **10**                                                                                      | Igual a `MIN_PASSWORD_LENGTH`; o teste `domínio ↔ banco` confere o `config.toml`.             |
| Edge Functions                                                      | `supabase functions deploy` das quatro funções                                              | `admin-create-supplier`, `admin-supplier-link`, `signup-status`, `public-signup`.             |
| Edge Functions → JWT                                                | `verify_jwt` conforme `config.toml` (as duas de admin ligadas, as duas públicas desligadas) | As funções do administrador ainda conferem, por dentro, que quem chama é administrador ativo. |

As variáveis `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` chegam às funções sozinhas. A chave de serviço **nunca** vai para o front nem para o repositório.

## Primeiro administrador

Uma vez, depois de aplicar as migrations:

```sh
SUPABASE_URL=https://<projeto>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<chave de serviço> \
node scripts/bootstrap-admin.ts --email dono@empresa.com --nome "Nome do dono" --app-url https://<endereço do app>
```

O script imprime um link. A pessoa abre, toca em "Continuar", escolhe a senha e já entra. Rodar de novo para o mesmo e-mail só gera outro link (serve para quem perdeu o acesso). Nenhuma senha passa pelo script.

## Fornecedor novo

1. Fornecedores → nome e e-mail → **Cadastrar fornecedor**.
2. Aparece o link de acesso. **Enviar pelo WhatsApp** abre o WhatsApp com a mensagem pronta; **Copiar link** serve para qualquer outro meio.
3. O fornecedor abre o link, toca em **Continuar**, escolhe a senha (10 caracteres ou mais) e já cai nas reservas.

## "Não consigo entrar"

- **Perdeu a senha ou o link venceu** ("Este link venceu ou já foi usado"): Fornecedores → **Gerar novo link de …** e enviar. O link vale 24 horas e só uma vez.
- **"Sua conta foi desativada":** foi desativada por um administrador. Fornecedores → **Reativar …**. As reservas que foram canceladas na desativação não voltam.
- **E-mail digitado errado no cadastro:** não há edição de e-mail. Desative a conta e cadastre de novo com o e-mail certo.

## Desativar um fornecedor

Fornecedores → **Desativar …** → confirmar. O acesso some na hora (mesmo com o app aberto, a próxima ação é recusada) e as reservas de hoje em diante são canceladas, devolvendo as vagas. O histórico fica, e tudo vai para a auditoria (`audit_log`, só o administrador lê).

## Cadastro pela página (/cadastro)

Em Configurações, escolha:

- **Fechado** (padrão): a página avisa que o cadastro está fechado.
- **Com código:** o app mostra o código (por exemplo `K7QD-4MXA`) e o link de convite (`/cadastro?codigo=K7QD-4MXA`). Envie por WhatsApp, e-mail seu ou fale o código por telefone (não tem `0`, `O`, `1` nem `I`). **Gerar novo código** invalida o anterior; as contas já criadas continuam.
- **Livre:** qualquer pessoa cria conta. **Não ligue em produção** sem SMTP e sem proteção contra robôs (veja o ADR 0006). Se aparecerem cadastros indesejados, volte para "Com código" e desative as contas pelo app.

Limites: 20 tentativas por hora por IP e 5 por e-mail; passou disso, a página responde "Muitas tentativas".

## Se algo der errado

| Sintoma                                                  | Onde olhar                                                                                                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "O servidor de contas não respondeu" ao cadastrar        | Logs da função (`admin-create-supplier`) no painel do Supabase. Se o Auth estiver fora, nada é criado pela metade: a função desfaz a conta se não conseguir gerar o link. |
| Fornecedor abre o link e cai em "venceu ou já foi usado" | `otp_expiry` (tem de ser 86400) ou o link já foi usado; gerar outro.                                                                                                      |
| Modo Livre: pessoa criou conta e não consegue entrar     | A conta espera a confirmação do e-mail; sem SMTP não há e-mail. Gere um link de ativação pelo administrador (Fornecedores).                                               |
| Reserva de fornecedor desativado ainda aparece           | Não deveria: a desativação cancela. Confira `audit_log` (`bookings`, `cancel_reason = 'Fornecedor desativado'`).                                                          |
