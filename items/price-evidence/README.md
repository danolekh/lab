# Where the price comes from

Made for [Minimist](https://minimist.com), which prices donated items for charity shops from
similar sales. A design concept, not affiliated with Minimist. The demo's photos are CC0 from
Unsplash ([photos.md](photos.md)) and its sales are made up.

Live: https://www.danolekh.com/lab/price-evidence

```bash
npx shadcn@latest add https://www.danolekh.com/r/price-evidence.json
```

```tsx
import { PriceEvidence } from "@/components/price-evidence";

<PriceEvidence
  sales={[{ price: 41.5, soldAt: "2026-09-12", channel: "eBay", condition: "Very good" }, ...]}
  currency="GBP"
  locale="en-GB"
/>
```

| Prop | Default | |
| --- | --- | --- |
| `sales` | | `{ price, soldAt, channel?, condition? }[]` |
| `range` | middle half of the sales | the suggested range, inclusive, `[from, to]` |
| `currency`, `locale` | `"GBP"`, `"en-GB"` | for the prices and dates |
| `step` | `1` | how wide one column of dots is, in currency units |
| `animate` | `true` | drop the sales in on first view |
| `ratio` | | fix the plot's height as a share of its width; the dots shrink to fit |
| `label`, `basis` | "Suggested price", "Based on n similar sales" | the words |

Restyle it with `--pe-accent` (the range and its dots, default `--primary`), `--pe-dot` (the other
dots), `--pe-band` (the range's fill) and `--pe-axis` (the axis).

- The plot is one tab stop. Left and right step through the sales by price, Home and End jump to
  the cheapest and the priciest, Escape clears. A live region reads each sale.
- With reduced motion the dots are in place and the numbers are final, with no Replay button.
- No dependencies beyond React 19. The keyframes ship in a `<style>` that React hoists and dedupes.
- The colour variables can be set on the component or on any parent, `dark:` classes included.
