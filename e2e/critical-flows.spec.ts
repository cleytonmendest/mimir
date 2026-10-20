import { expect, test } from '@playwright/test'

/**
 * Os dois fluxos que não podem quebrar. Ficam como test.fixme até existir a tela:
 * aparecem como "pendentes" em todo relatório, e quem implementar a tela troca por test().
 */

test('o app abre', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Rota do repositor' })).toBeVisible()
})

test.fixme('repositor abre a tela Hoje, faz check-in, check-out e a visita fica "Feita"', async () => {
  // 1. entrar como repositor  2. ver as visitas de hoje em ordem
  // 3. check-in numa visita   4. check-out com observação   5. status "Feita" e horários gravados
})

test.fixme('líder remaneja um mercado de um dia para outro e a mudança fica no log', async () => {
  // 1. entrar como líder  2. abrir a semana de um repositor  3. mover um mercado para outro dia
  // 4. o repositor vê a mudança  5. o log mostra quem mudou o quê
})
