# LGPD: dados pessoais da Agenda de Degustações

Notas de quem desenvolve, para o dono dos mercados e para quem for revisar o assunto. **Não é parecer jurídico**: os pontos marcados "decidir" pedem a palavra do dono e, se possível, de quem cuida do jurídico da empresa antes da produção.

## O que o sistema guarda sobre pessoas

| Dado                                  | Onde                                                         | Quem vê                                             | Por quê                                   | Por quanto tempo                                  |
| ------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------- | ----------------------------------------- | ------------------------------------------------- |
| E-mail e senha (guardada só em hash)  | Supabase Auth (`auth.users`)                                 | Ninguém pela API; quem opera o projeto              | Entrar no app                             | Enquanto a conta existir                          |
| Nome ou empresa e e-mail              | `profiles`                                                   | A própria pessoa e o administrador                  | Identificar o fornecedor na agenda        | Enquanto a conta existir (e no histórico, abaixo) |
| Reservas (mercado, dia, quem, quando) | `bookings`                                                   | O fornecedor vê as próprias; o administrador, todas | Organizar os estandes                     | Histórico guardado (decidir, abaixo)              |
| Auditoria de mudanças                 | `audit_log` (ator, tabela, linha antes/depois)               | Só o administrador                                  | Saber quem fez o quê (contestação, abuso) | Decidir (ADR 0004)                                |
| Tentativas de cadastro pela página    | `signup_attempts` (**só hash** do IP e do e-mail, resultado) | Ninguém pela API                                    | Limitar abuso                             | 7 dias (apagado a cada cadastro bem-sucedido)     |

Não há rastreador, publicidade, localização nem dado de menor. O fornecedor **não** vê dado de outro fornecedor (provado em pgTAP, por tabela e por função).

## Quem trata os dados (operadores)

Supabase (banco e login), a hospedagem do app (a escolher), Sentry (erros, quando ligado) e o provedor de e-mail (quando existir). Precisam de contrato ou termo de tratamento de dados e de região adequada (o banco fica em São Paulo, `sa-east-1`). Os dados de erro enviados ao Sentry não devem conter e-mail nem nome (configurar o scrubbing ao ligar).

## Decisões pendentes

1. **Base legal e aviso de privacidade.** Em geral execução do relacionamento com o fornecedor ou legítimo interesse, por ser contato profissional. Falta o texto do aviso e onde ele aparece (por exemplo, ao ativar a conta). Decidir.
2. **Retenção.** O histórico de reservas e a auditoria crescem para sempre hoje. Propostas: reservas e auditoria por 5 anos, depois anonimizadas (o ADR 0004 deixou o prazo em aberto). Decidir antes da produção.
3. **Pedido do titular (acesso, correção, exclusão).** Não há tela. Procedimento manual abaixo, a confirmar com o jurídico.

## Procedimentos manuais

**Acesso e portabilidade:** exportar com a chave de serviço o perfil, as reservas e as linhas de `audit_log` do titular (`row_id` ou `actor_id` dele) e entregar em CSV.

**Correção de nome:** o administrador edita pelo banco ou a pedido (não há tela de edição de fornecedor). O e-mail só muda junto com o login (pelo Auth), nunca só no perfil.

**Exclusão:** a conta não pode simplesmente ser apagada, porque as reservas apontam para o perfil (a exclusão é barrada de propósito, para não apagar o histórico). O caminho é **desativar e anonimizar**, com a chave de serviço, num único passo:

```sql
-- troque <id> pelo id do fornecedor
update public.profiles
   set full_name = 'Titular removido', email = null, deactivated_at = coalesce(deactivated_at, now())
 where id = '<id>';
update auth.users
   set email = 'removido-<id>@invalido.test', raw_user_meta_data = '{}'::jsonb,
       encrypted_password = '', banned_until = 'infinity'
 where id = '<id>';
-- a auditoria guarda a linha do perfil com o e-mail antigo: limpe esses campos
update public.audit_log
   set old_row = null, new_row = null, changes = null
 where table_name = 'profiles' and row_id = '<id>';
```

Depois, confira que nenhuma reserva futura ficou (a desativação pelo app as cancela; pelo SQL acima não, então cancele antes pelo app).

## O que o produto já faz a favor da privacidade

- O fornecedor vê só contagens de vagas dos outros, nunca nomes.
- O administrador é o único que lê nomes de quem reservou e a auditoria.
- IP e e-mail de quem tenta se cadastrar só ficam como hash, por 7 dias.
- Senha nunca passa pelo administrador (link de ativação).
- Conta desativada perde o acesso a tudo, na hora.
