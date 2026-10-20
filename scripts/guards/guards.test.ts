import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as designSystem from './design-system.ts'
import * as disabledTests from './disabled-tests.ts'
import * as migrations from './migrations.ts'
import * as migrationsImmutable from './migrations-immutable.ts'
import * as noServiceRole from './no-service-role.ts'

/**
 * Um guard que nunca dispara é pior que nenhum guard: aqui cada um é testado contra
 * um projeto de mentira, com o caso que ele deve barrar e o que ele deve deixar passar.
 */

const created: string[] = []

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'guard-'))
  created.push(root)
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), content)
  }
  return root
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('no-service-role', () => {
  it('deixa passar um front limpo e ignora o .env.example', () => {
    const root = project({
      'src/app.ts': 'const key = import.meta.env.VITE_SUPABASE_ANON_KEY',
      '.env.example': '# NUNCA usar a service_role aqui',
    })
    expect(noServiceRole.check(root).violations).toEqual([])
  })

  it.each([
    ['o nome da chave', 'const k = process.env.SUPABASE_SERVICE_ROLE_KEY'],
    ['a palavra em base64 (JWT colado)', 'const jwt = "eyJhbGci.c2VydmljZV9yb2xl.assinatura"'],
    ['o formato novo de chave secreta', 'const k = "sb_secret_abc123"'],
  ])('barra %s em src/', (_label, content) => {
    const root = project({ 'src/lib/api.ts': content })
    expect(noServiceRole.check(root).violations).toEqual([
      expect.stringContaining('src/lib/api.ts'),
    ])
  })

  it('barra a chave num .env real', () => {
    const root = project({ '.env.local': 'SUPABASE_SERVICE_ROLE_KEY=abc' })
    expect(noServiceRole.check(root).violations).toHaveLength(1)
  })
})

describe('design-system', () => {
  const tokens = { 'src/design-system/tokens.css': '@theme { --color-brand: #1d4ed8; }' }

  it('deixa passar componente com story, tokens com hex e classes de token', () => {
    const root = project({
      ...tokens,
      'src/design-system/components/Card/Card.tsx': 'export const c = "bg-brand text-text"',
      'src/design-system/components/Card/Card.stories.tsx': 'export default {}',
      'src/design-system/components/Card/Card.test.tsx': 'export {}',
    })
    expect(designSystem.check(root).violations).toEqual([])
  })

  it('barra componente sem story', () => {
    const root = project({ ...tokens, 'src/design-system/components/Card/Card.tsx': 'export {}' })
    expect(designSystem.check(root).violations).toEqual([expect.stringContaining('sem story')])
  })

  it('barra cor em CSS fora de tokens.css, mas não em comentário', () => {
    const root = project({
      ...tokens,
      'src/extra.css': '.a { color: #ff0000; }',
      'src/ok.css': '/* era #ff0000 */ .b { color: var(--color-brand); }',
    })
    expect(designSystem.check(root).violations).toEqual([expect.stringContaining('src/extra.css')])
  })

  it.each(['bg-red-500', 'text-white', 'border-slate-200', 'bg-[#fff]', 'ring-[rgb(0,0,0)]'])(
    'barra a classe de cor "%s"',
    (cls) => {
      const root = project({ ...tokens, 'src/ui.tsx': `export const c = "p-4 ${cls}"` })
      expect(designSystem.check(root).violations).toEqual([expect.stringContaining('src/ui.tsx')])
    },
  )

  it('não confunde tokens com a paleta (text-text, bg-surface, text-muted)', () => {
    const root = project({
      ...tokens,
      'src/ui.tsx': 'export const c = "text-text bg-surface text-text-muted"',
    })
    expect(designSystem.check(root).violations).toEqual([])
  })
})

describe('migrations', () => {
  const ok = 'create table public.a (id int);\nalter table public.a enable row level security;\n'

  it('deixa passar tabela com RLS e nome correto', () => {
    const root = project({ 'supabase/migrations/20261020000000_init.sql': ok })
    expect(migrations.check(root).violations).toEqual([])
  })

  it('barra nome fora do padrão', () => {
    const root = project({ 'supabase/migrations/init.sql': ok })
    expect(migrations.check(root).violations).toEqual([
      expect.stringContaining('nome fora do padrão'),
    ])
  })

  it('barra tabela sem RLS, mas aceita RLS ligado em migration posterior', () => {
    const bare = 'create table public.b (id int);'
    const withoutRls = project({ 'supabase/migrations/20261020000000_a.sql': bare })
    expect(migrations.check(withoutRls).violations).toEqual([expect.stringContaining('"b"')])

    const later = project({
      'supabase/migrations/20261020000000_a.sql': bare,
      'supabase/migrations/20261021000000_b.sql': 'alter table public.b enable row level security;',
    })
    expect(migrations.check(later).violations).toEqual([])
  })

  it('barra desligar RLS e dar privilégio ao anon', () => {
    const root = project({
      'supabase/migrations/20261020000000_a.sql': `${ok}alter table public.a disable row level security;`,
      'supabase/migrations/20261021000000_b.sql': 'grant select on public.a to anon;',
    })
    expect(migrations.check(root).violations).toHaveLength(2)
  })
})

describe('disabled-tests', () => {
  it('barra it.only, it.skip e xit em testes', () => {
    const root = project({
      'src/a.test.ts': "it.only('x', () => {})",
      'src/b.test.ts': "describe.skip('x', () => {})",
      'e2e/c.spec.ts': "xit('x', () => {})",
    })
    expect(disabledTests.check(root).violations).toHaveLength(3)
  })

  it('permite test.fixme (explícito) e não olha arquivos que não são de teste', () => {
    const root = project({
      'e2e/flow.spec.ts': "test.fixme('fluxo ainda sem tela', () => {})",
      'src/helper.ts': "const text = 'it.only'",
    })
    expect(disabledTests.check(root).violations).toEqual([])
  })
})

describe('migrations-immutable', () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@t.dev', '-c', 'commit.gpgsign=false', ...args],
      {
        cwd,
        encoding: 'utf8',
      },
    )

  function repo() {
    const root = project({ 'supabase/migrations/20261020000000_init.sql': 'create table a();' })
    git(root, 'init', '-q', '-b', 'main')
    git(root, 'add', '.')
    git(root, 'commit', '-q', '-m', 'base')
    git(root, 'checkout', '-q', '-b', 'feature')
    return root
  }

  it('pula com aviso quando não há base para comparar', () => {
    const root = repo()
    expect(migrationsImmutable.check(root, '')).toEqual({
      violations: [],
      notes: [expect.stringContaining('não verificada')],
    })
  })

  it('aceita migration nova', () => {
    const root = repo()
    writeFileSync(join(root, 'supabase/migrations/20261021000000_more.sql'), 'create table b();')
    git(root, 'add', '.')
    git(root, 'commit', '-q', '-m', 'nova')
    expect(migrationsImmutable.check(root, 'main').violations).toEqual([])
  })

  it('barra migration existente alterada ou apagada', () => {
    const edited = repo()
    writeFileSync(
      join(edited, 'supabase/migrations/20261020000000_init.sql'),
      'create table a(x int);',
    )
    git(edited, 'commit', '-q', '-am', 'edita')
    expect(migrationsImmutable.check(edited, 'main').violations).toEqual([
      expect.stringContaining('alterada'),
    ])

    const removed = repo()
    rmSync(join(removed, 'supabase/migrations/20261020000000_init.sql'))
    git(removed, 'commit', '-q', '-am', 'apaga')
    expect(migrationsImmutable.check(removed, 'main').violations).toEqual([
      expect.stringContaining('apagada'),
    ])
  })

  it('pega também a edição ainda não commitada', () => {
    const root = repo()
    writeFileSync(
      join(root, 'supabase/migrations/20261020000000_init.sql'),
      'create table a(x int);',
    )
    expect(migrationsImmutable.check(root, 'main').violations).toHaveLength(1)
  })

  it('base inexistente não derruba: avisa e segue', () => {
    const root = repo()
    expect(migrationsImmutable.check(root, 'origin/nao-existe').notes).toEqual([
      expect.stringContaining('verificação pulada'),
    ])
  })
})
