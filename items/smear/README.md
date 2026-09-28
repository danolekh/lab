# Type that smears

Made for [wild](https://wild.as), the Vienna design and technology studio, in their style. A design
concept, not affiliated with wild. The type is Inter Tight, standing in for their Sneak.

Live: https://www.danolekh.com/lab/smear

```bash
npx shadcn@latest add https://www.danolekh.com/r/smear.json
```

```tsx
import { Smear } from "@/components/smear";

<div className="overflow-clip">
  <Smear as="h1" className="text-7xl">
    wild is a design and technology partner for modern brands, startups and enterprises.
  </Smear>
</div>
```

| Prop | Default | |
| --- | --- | --- |
| `as` | `"p"` | the element: `h1` to `h6`, `p`, `div`, `blockquote` or `span` |
| `strength` | `1` | how far a fast stroke carries the ink; `1` reaches 1.6 brush widths |
| `radius` | 1.1 × the font size | the brush's width in px |
| `settle` | `900` | how long a smear takes to come back to crisp type, in ms |
| `bleed` | 1.5 × `radius` | how far past its box the ink may be carried, in px |
| `maxDpr` | `2` | the most device pixels per CSS pixel the canvas draws |
| `maxPixels` | `8000000` | the most pixels the canvas draws; the pixel ratio drops below `maxDpr` past it |

Any other props pass through to the element. The font, size, weight, colour and letter spacing come
from its computed style, so style it like any text.

- The text stays real DOM text: selection, copy, find in page, screen readers and print use it. The
  canvas behind it is `aria-hidden` and ignores the pointer.
- The canvas reaches `bleed` px past the element on every side, so put it inside something with
  `overflow: clip` (or `hidden`) if that would scroll the page sideways.
- Without WebGL2, with `prefers-reduced-motion: reduce` or in forced colours, it's the plain text.
  If the WebGL context is lost it shows the text and starts again once.
- It only draws while a smear is settling, and not at all off screen.
- The element carries `data-state="live"` once the canvas has taken over, and the canvas
  `data-ready`.
- No dependencies beyond React 19 and a browser with WebGL2.
