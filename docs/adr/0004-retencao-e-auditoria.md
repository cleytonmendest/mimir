# ADR 0004: Retenção e tamanho do log de auditoria

**Status:** proposto. Decidir o prazo de retenção **antes da produção** (fatia 5.5).

## Contexto

`audit_row_change` grava, para cada insert, update e delete em `visits`, `standard_route` e `markets`, a linha **antes**, a linha **depois** e a diferença (`old_row`, `new_row`, `changes`). A cada visita há em média 3 a 4 entradas (criação, check-in, check-out, às vezes ajustes do líder), de cerca de 1 KB cada.

Estimativa grosseira para 40 repositores com ~6 visitas por dia: ~88 mil visitas por ano e **~300 MB por ano só de auditoria**. Isso pesa num plano pequeno do banco e cresce sem limite.

## Proposta

1. **No update, gravar só a diferença** (`changes`), sem `old_row` e `new_row` completos. Insert e delete continuam com a linha inteira. **Feito na migration da sincronização (fatia 1.2)**, que também registra a origem da mudança (`audit_log.source`: `app`, `sync` ou `system`).
2. **Definir a retenção** com o jurídico: por quanto tempo o log fica consultável e o que acontece depois (arquivar fora do banco ou apagar). A tabela é só de inserção pela aplicação.
3. **Dados pessoais:** hoje `profiles` não é auditado (a troca de papel não deixa rastro; entra na fatia 4.1). O log guarda ids de usuário, não nomes.

## Consequências

- O histórico de update fica menor, mas a leitura "como era antes" passa a ser reconstruída a partir das diferenças.
- Sem decisão de retenção, o crescimento do log é um custo e um risco de LGPD a resolver no marco 5.
