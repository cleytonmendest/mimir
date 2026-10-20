# Design system

Tailwind v4 + [shadcn/ui](https://ui.shadcn.com) (estilo `radix-vega`). O código dos componentes do
shadcn é **nosso**: o CLI copia para o repositório e a gente adapta.

## Onde fica cada coisa

| Caminho                 | O que é                                                                       |
| ----------------------- | ----------------------------------------------------------------------------- |
| `tokens.css`            | **Único** lugar onde cor, raio e fonte existem. Nomes do shadcn (`primary`…)  |
| `components/ui/`        | Componentes copiados do shadcn (`button.tsx`, ...), um `.stories.tsx` ao lado |
| `components/<Nome>/`    | Componentes nossos, que não vêm do shadcn (ex.: `StatusBadge`)                |
| `utils.ts`              | `cn()` para juntar classes                                                    |
| `../../components.json` | Configuração do CLI (aliases apontam para cá)                                 |

Cor de status de visita (`status-*`) é do domínio e não faz parte do vocabulário do shadcn.

## Adicionar um componente

```sh
npx shadcn add dialog
npm run verify
```

O que costuma precisar de ajuste depois do `add` (o CI barra os itens 1 e 2 e o TypeScript aponta
o 3; o 4 e a sobrescrita do `button.tsx` **ninguém confere**):

1. **Story**: todo `ui/x.tsx` precisa de `ui/x.stories.tsx` (guard `design-system`).
2. **Cor**: `bg-black/…`, `text-white` e afins são da paleta padrão e o guard barra. Troque por um
   token (`text-destructive-foreground` já existe; para o fundo escurecido de Dialog/Sheet crie um
   `overlay` em `tokens.css`). Variáveis de cor que o CLI escrever em `index.css` (ex.: `sidebar`,
   `chart`) vão para `tokens.css`.
3. **Botão**: não existem `size="sm"`/`"xs"`/`"icon-sm"`. Troque pelo tamanho que existe (`icon`,
   `default`); o TypeScript aponta. Se o CLI perguntar se sobrescreve `button.tsx`, responda **não**
   (`yes n | npx shadcn add dialog`): aceitar traz de volta os tamanhos pequenos, sem nenhum erro.
4. **Alvo de toque de 44px**: `Input`, `Select`, `Tabs` e afins vêm com `h-9`/`h-8`. Suba para `h-11`.
   Nada automático confere isso: confira no Storybook.

Só existe tema claro. As classes `dark:` que os componentes trazem não fazem nada (o variant `dark`
só vale sob `.dark`, que ninguém aplica); apague-as se atrapalharem a leitura.
