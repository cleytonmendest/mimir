import { spawnSync } from 'node:child_process'

/**
 * Roda a suíte de domínio em vários fusos. Regra de calendário que depende do fuso da máquina
 * passa no notebook de quem escreveu e quebra em produção; aqui ela quebra antes.
 */
const ZONES = ['UTC', 'America/Sao_Paulo', 'America/Los_Angeles', 'Pacific/Kiritimati']

let failed = false
for (const zone of ZONES) {
  console.log(`\n=== TZ=${zone}`)
  const result = spawnSync('npx', ['vitest', 'run', 'src/domain'], {
    stdio: 'inherit',
    env: { ...process.env, TZ: zone },
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) failed = true
}

process.exit(failed ? 1 : 0)
