# ADR 0004: Retenção e tamanho do log de auditoria

**Status:** proposto. Decidir o prazo de retenção **antes da produção** (fatia 6.3 do plano).

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

## Atualização de 22/10/2026 (reposicionamento do produto)

O produto mudou (ADR 0005): `visits` e `standard_route` não existem mais. Hoje só `markets` é auditado; entram `bookings` e `closed_days` no Bloco 2 e `profiles` (troca de papel e desativação) no Bloco 5.

A estimativa de volume muda de ordem. No pior caso (50 mercados, 3 estandes, 365 dias, tudo reservado) são cerca de 55 mil reservas por ano, com 1 a 2 entradas de log cada: **na casa de 80 MB por ano**, não 300 MB. A proposta 1 (só a diferença no update) já está feita e segue valendo; a retenção (proposta 2) continua a decidir antes da produção.
