# Liquid Glass

Liquid Glass on the web, as one React component. After Aave's write-up,
[Building Glass for the Web](https://aave.com/design/building-glass-for-the-web).

Live: https://www.danolekh.com/lab/glass

```bash
npx shadcn@latest add https://www.danolekh.com/r/glass.json
```

```tsx
import { Glass } from "@/components/glass";

<Glass className="absolute left-8 top-8 h-36 w-64" radius={999} bezel={30} depth={13}>
  …
</Glass>
```

| Prop | Default | |
| --- | --- | --- |
| `radius` | `28` | corner radius in px (`999` for a pill) |
| `bezel` | `24` | how far in from the edge the glass curves, in px |
| `depth` | `10` | how far the backdrop moves at the edge, in px; capped at `0.45 × bezel`, past which the lens folds over itself |
| `chroma` | `0.2` | colour fringe: red and blue bend this share more and less than green |
| `specular` | `45` | where the light comes from, in degrees (45 is the top left) |
| `highlight` | `0.6` | how bright the rim is, 0 to 1 |
| `frost` | `0` | a blur under the glass, in px |
| `tint` | `rgba(255,255,255,0.06)` | the glass's own colour |

Any other `div` props pass through. The component sets no `position` of its own, so give it
`relative` or `absolute` as the layout needs.

- The bending is an SVG `feDisplacementMap` in `backdrop-filter`, which only Chromium draws.
  Safari, Firefox and `prefers-reduced-transparency: reduce` get a frosted panel with the same rim.
  The element carries `data-glass="bent"` or `data-glass="plain"`.
- The map is drawn from the element's layout size at the screen's pixel ratio (up to 2.5×) and is
  redrawn when the size changes. Moving the element costs nothing; resizing it every frame would.
- No dependencies beyond React 19.
