# ADR 0001: Offline do repositor por eventos, com o servidor vencendo

**Status:** aceito (21/10/2026)

## Contexto

Repositores trabalham dentro de mercados, muitas vezes sem sinal. Hoje a tela "Hoje" grava online, por compare-and-set (`saveVisitChange`), e não abre sem rede. Perder ou duplicar um check-in é o pior defeito possível do produto.

## Decisão

- **O aparelho guarda eventos, não estado**: `checkIn`, `checkOut` e `markNotDone`, cada um com `client_event_id`, a hora em que aconteceu e um `seq` do aparelho, numa fila local (IndexedDB, **um banco por usuário**). A ordem é a do `seq`, nunca a de `occurredAt`.
- **A tela mostra o servidor mais os eventos pendentes**, aplicados com o próprio domínio (`projectVisits`).
- **Quando o domínio encerra sozinho uma visita aberta** (check-in em outra visita), o aparelho grava na mesma transação os eventos derivados explícitos. O servidor não tem regra entre visitas.
- **O servidor aplica por uma função versionada** (`sync_visit_events_v1`), atômica e idempotente, que grava o resultado (aplicado ou recusado, e por quê) junto do evento. **O servidor vence**: se a visita mudou (o líder cancelou, outro aparelho avançou), o evento volta recusado e a tela explica.
- **Via única**: depois da migração, o repositor deixa de ter `UPDATE` direto em `visits`; online ou offline, tudo passa pelo evento. Garante "tudo é auditado".
- **As visitas são criadas pelo servidor** (job noturno). O aparelho nunca cria visita sem rede.
- **Sincroniza** ao abrir, ao voltar o sinal, depois de cada ação e num botão. Sem Background Sync (não existe no iOS).
- **O app abre sem rede** com a identidade guardada no aparelho.

## Contrato de `sync_visit_events_v1` (fatia 1.2)

- **Entrada:** `(p_device_id uuid, p_client_version text, p_events jsonb)`. Até 50 eventos `{ client_event_id, seq, visit_id, type, occurred_at, note?, reason?, caused_by? }`, com `occurred_at` em ISO 8601 completo. A função aplica em ordem de `seq`.
- **Saída:** `{ server_now, results[], visits[] }`. Cada resultado traz `client_event_id`, `status` (`applied` ou `rejected`), `code`, `visit_status` (o estado atual, para a tela explicar) e `duplicate` (reenvio de algo já decidido). `visits[]` são só as visitas do repositor tocadas pelo lote, para atualizar a cópia local. App abaixo de `app_config.min_client_version` recebe só `{ upgrade_required, min_client_version, server_now }`.
- **Um vocabulário de recusa só.** Os códigos de `src/domain` (`INVALID_TRANSITION`, `REASON_REQUIRED`, `CHECKOUT_BEFORE_CHECKIN`, `VISIT_IN_FUTURE`, `VISIT_IN_PAST`, `FORBIDDEN`, `VISIT_NOT_FOUND`), mais três só do servidor: `CLOCK_INVALID` (evento mais de 10 min no futuro), `ID_CONFLICT` (o `client_event_id` já é de outra pessoa ou de outra visita) e `INVALID_DATA`. "Cancelada pelo líder" e "já registrada" são leituras da tela sobre `INVALID_TRANSITION` mais `visit_status`, sem código próprio.
- **O que fica gravado.** O evento aplicado ou recusado entra em `visit_events` com o resultado, o aparelho, o `seq` e a versão do app. Dado ilegível, visita inexistente e visita de outro repositor só voltam recusados na resposta: não viram linha, para ninguém escrever no histórico alheio.
- **Idempotência.** Reenviar um id já decidido devolve o resultado gravado, sem aplicar de novo. As visitas do lote são travadas em ordem de id, então envios simultâneos do mesmo aparelho esperam um pelo outro.
- **Transporte (`src/lib/supabase/sync-gateway.ts`, fatia 1.3).** Recusa de evento não é falha: vem em `results`. Falha de transporte lança `SyncFailure` e a fila continua intacta, porque reenviar é sempre seguro: `NETWORK` (sem sinal, ou o envio passou de 30 s), `AUTH` (sessão vencida ou ausente), `SERVER` (500, 404 se a função ainda não foi implantada, 408, 429) e `BAD_REQUEST` (defeito deste app; repetir não resolve). Resposta que o app não entende vira `INVALID_RESPONSE`; motivo de recusa desconhecido vira `UNRECOGNIZED` em vez de quebrar.
- **As regras valem nos dois lados.** `src/domain/fixtures/visit-events.cases.json` é rodado pelo domínio (Vitest) e pela função (pgTAP gerado por `npm run db:gen-cases`).

## O que verificamos (spike S1, supabase-js / auth-js 2.118, contra o GoTrue local)

| Situação                                   | O que acontece                                                                                         | Consequência                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Token válido, sem rede                     | `getSession()` devolve a sessão na hora                                                                | funciona                                                             |
| Token **vencido**, sem rede                | `getSession()` **trava ~25 s** (tentativas com espera crescente) e falha; a sessão continua guardada   | a abertura não pode esperar o SDK: usar a identidade guardada        |
| Depois dessa falha                         | o SDK repete o erro por **60 s** (`REFRESH_FAILURE_COOLDOWN_MS`), mesmo com rede de volta              | recuperar leva até ~60-90 s; a tela precisa de estado "reconectando" |
| Rede que "pendura" (sem erro nem resposta) | `getSession()` **nunca retorna**                                                                       | timeout nosso, por fora, é obrigatório                               |
| Refresh token revogado                     | falha em ~0,2 s, remove a sessão e emite `SIGNED_OUT`                                                  | vai ao login; a fila precisa sobreviver (banco por usuário)          |
| Admin redefine a senha                     | as sessões caem na hora, mas o **token de acesso já emitido continua valendo no RLS até vencer** (1 h) | desativar usuário tem de ser checado **nas políticas do banco**      |

Pendente de verificar em celular real (spike S2): se IndexedDB e service worker sobrevivem a app encerrado, reinício e dias sem uso, principalmente no iOS.

## Consequências

- Mais código no aparelho (fila, motor de sincronização, PWA) em troca de nunca perder o trabalho de campo.
- A regra de transição existe no domínio (TypeScript) e na função do banco. Casos de teste compartilhados evitam que divirjam.
- O líder é online-only; offline é só do repositor.
