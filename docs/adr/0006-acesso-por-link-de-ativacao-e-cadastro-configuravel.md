# ADR 0006: Acesso por link de ativação e cadastro público configurável

**Status:** aceito (22/10/2026).

## Contexto

Quem usa o app são fornecedores que o dono dos mercados conhece, e o dono não entende de tecnologia. Ele quer cadastrar quem pode reservar, mas combinou-se deixar também uma página de cadastro, que ele liga e desliga. Três riscos pesam: conta de administrador criada por engano ou por abuso, senha passando pelas mãos de quem cadastra, e a página pública virando porta aberta. Não há provedor de e-mail contratado, e o resultado não pode depender de um.

## Decisão

- **O app nunca cria conta pelo navegador.** O Auth fica com `enable_signup = false`. Contas nascem em Edge Functions, as únicas que usam a chave de serviço (guard: nunca em `src/`).
- **O administrador cadastra sempre**, em Fornecedores. A conta nasce confirmada e **sem senha**; a função devolve o token de um link de ativação (`/definir-senha?token=…`, 24 horas, uso único) que o administrador copia ou manda pelo WhatsApp. O fornecedor escolhe a própria senha. Nenhuma senha passa pelo administrador, e perder o acesso é só gerar outro link.
- **O link só é gasto no toque em "Continuar".** Programas que abrem links sozinhos (prévia do WhatsApp, antivírus) não consomem o token.
- **A página `/cadastro` tem três modos**, escolhidos pelo administrador em Configurações: **Fechado** (padrão), **Com código de convite** e **Livre**. O código tem 8 caracteres sem `0/O/1/I`, sorteado no banco, visível só ao administrador, revogável ("gerar novo código" invalida o anterior e mantém as contas criadas). O sistema não manda e-mail no caminho do código.
- **A configuração vive em `signup_settings`**, com RLS só para o administrador e escrita só por funções (`set_signup_mode_v1`, `regenerate_invite_code_v1`). Nada disso entra em tabela legível por todo usuário logado. A página pública só sabe o modo (`signup-status`).
- **Abuso:** `public-signup` compara o código em tempo constante, limita tentativas por IP e por e-mail na última hora (guardando só hash, em `signup_attempts`, que só a chave de serviço toca) e nunca aceita o papel vindo do pedido: toda conta nasce `supplier`. No modo Livre, a resposta para e-mail já cadastrado é igual à de e-mail novo, para não revelar quem é cliente.
- **Desativar corta o acesso em todas as camadas.** `profiles.deactivated_at` é lido pelo RLS (mercados, datas fechadas, reservas) e pelas funções de reserva; `set_supplier_active_v1` desativa e cancela as reservas de hoje em diante, devolvendo as vagas. Ninguém altera o próprio papel nem a própria desativação pela API (trigger), o que basta para sempre sobrar um administrador ativo.
- **Edge Functions sem dependências.** Só `fetch` no Auth e no PostgREST, com a lógica em `supabase/functions/_shared` (testada no Vitest com um Supabase falso que recusa o que o real recusaria) e entradas de três linhas. Não há pacote externo para baixar, auditar ou quebrar, e a partida é rápida.
- **Primeiro administrador:** `scripts/bootstrap-admin.ts`, com a chave de serviço, na máquina de quem implanta. Imprime o link de ativação.

## Consequências

- O modo Livre depende de SMTP configurado no projeto (confirmação de e-mail). Sem ele, a conta fica criada e não confirmada. Antes de ligar esse modo em produção faltam o SMTP e uma proteção contra robôs (Cloudflare Turnstile), que precisam de contas externas.
- O prazo de 24 horas do link vem do `otp_expiry` do Auth: tem de ser configurado igual no projeto hospedado (`docs/runbooks/acesso.md`).
- "Esqueci a senha" pelo próprio fornecedor não existe: ele pede um novo link ao administrador. Entra junto com o SMTP.
- Duas cópias das regras de validação (`src/domain/access.ts` e `supabase/functions/_shared/validate.ts`), porque as funções não importam de `src/`. `scripts/access-parity.test.ts` as põe lado a lado.
