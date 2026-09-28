# lab

Small interface things, each one built for a product I like. One folder per thing, each installable
with the shadcn CLI. Live at [danolekh.com/lab](https://www.danolekh.com/lab).

| | For | Install |
| --- | --- | --- |
| [Type that smears](items/smear) | wild | `npx shadcn@latest add https://www.danolekh.com/r/smear.json` |
| [Liquid Glass](items/glass) | after [Aave's write-up](https://aave.com/design/building-glass-for-the-web) | `npx shadcn@latest add https://www.danolekh.com/r/glass.json` |
| [Where the price comes from](items/price-evidence) | Minimist | `npx shadcn@latest add https://www.danolekh.com/r/price-evidence.json` |

The parts are written against shadcn's tokens (`--foreground`, `--muted-foreground`, `--popover`,
`--border`, `--ring`, `--primary`), so they pick up your theme. Each one's own variables are listed
in its README.

## Working here
- `pnpm dev`: every demo on one page at http://localhost:4180, or one alone with `?item=<slug>`.
- `pnpm registry:build`: writes `public/r/<slug>.json` from `registry.json`.
- `pnpm check`: types.

The demos are design concepts in each product's style. They're not affiliated with those companies,
and their data is made up.

MIT © Dan Olekh
