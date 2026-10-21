# ADR 0005: Reserva de estande com limite garantido no banco, sem offline

**Status:** aceito (22/10/2026). Substitui os ADRs 0001 (offline por eventos) e 0003 (fim do dia e conflitos).

## Contexto

O produto passou de "rota do repositor" para **Agenda de Degustações**: fornecedores reservam estandes de degustação por mercado e dia, com um limite de estandes por mercado, sem o dono se envolver. O dono aprovou um protótipo (`docs/prototipo/`). O defeito que o produto não pode ter é passar do limite quando dois fornecedores clicam na última vaga ao mesmo tempo.

## Decisão

- **Só online.** Uma vaga só existe se o servidor confirma na hora. Não há fila local, sincronização, service worker nem login offline. O código de offline que chegou a ser escrito (PR #6) foi descartado.
- **O servidor decide, numa função só.** `book_slot_v1(mercado, dia)` (`SECURITY DEFINER`) trava o par mercado e dia com `pg_advisory_xact_lock`, reavalia todas as regras (mercado ativo, dia dentro da janela, dia não fechado, fornecedor ainda sem reserva ali, vagas restantes) e só então insere. Clientes **não escrevem** em `bookings`: só pelas RPCs.
- **O limite vale em três camadas.** A RPC com a trava; um trigger de guarda na tabela, que pega a mesma trava e recusa um insert acima do limite (assim um erro futuro em uma função, ou um insert de script, não passa); e testes: concorrência real no banco e teste de modelo com `fast-check` no domínio.
- **Recusa por código**, com vocabulário único no TypeScript e no SQL (`FULL`, `CLOSED`, `OUT_OF_WINDOW`, `MARKET_INACTIVE`, `FORBIDDEN`). Reservar de novo o que já é seu devolve sucesso, então repetir (clique duplo, falha de rede) é seguro.
- **Privacidade.** O fornecedor lê só as próprias reservas e a disponibilidade como **contagem** (`market_availability_v1`), nunca nomes. Só o administrador vê quem reservou.
- **O dia é do servidor** (`company_date(now())`, ADR 0002); as datas são `date`, sem hora.
- **Reduzir o limite não cancela nada.** Dias que já tinham mais reservas continuam como estão; só as reservas novas respeitam o limite novo.

## Consequências

- Sem internet não se reserva.
- A tela pode estar desatualizada: o servidor recusa e a tela reconsulta e explica ("acabou de lotar").
- A trava serializa só reservas do mesmo par mercado e dia; com este volume o custo é desprezível.
- Como a RPC é a única porta de escrita, regras novas (por exemplo, limite de reservas por fornecedor) entram em uma função só.
- Fatias e testes: `docs/mvp.md`, blocos 2 e 3.
