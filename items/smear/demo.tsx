import "@fontsource-variable/inter-tight";
import { Smear } from "./smear";

/* The concept, in wild's style (wild.as): their own line on a white page in their type colour.
 * Sneak, their face, is commercial, so the type is Inter Tight. Not affiliated with wild. */

export default function SmearDemo() {
  return (
    <div data-slot="wild-demo" className="wild-demo">
      <style href="wild-demo" precedence="default">
        {CSS}
      </style>
      <div data-slot="wild-stage" className="wild-stage">
        <Smear as="h2" className="wild-head" maxDpr={4}>
          wild is a design and technology partner for modern brands, startups and enterprises.
        </Smear>
      </div>
      <p data-slot="wild-note" className="wild-note">
        A design concept for wild, not affiliated.
      </p>
    </div>
  );
}

const CSS = `
.wild-demo{container-type:inline-size}
.wild-demo,.wild-demo *{font-family:"Inter Tight Variable","Inter Tight",ui-sans-serif,system-ui,sans-serif}
.wild-stage{position:relative;overflow:clip;display:flex;flex-direction:column;justify-content:flex-end;min-height:380px;padding:clamp(20px,6cqi,56px);border-radius:2px;background:#fff;color:#1d1d1d;touch-action:pan-y;box-shadow:inset 0 0 0 1px #e9e9e9}
@container (min-width:560px){.wild-stage{aspect-ratio:16/10;min-height:0}}
.wild-head{margin:0;font-size:clamp(30px,7.4cqi,76px);font-weight:400;line-height:1.08;letter-spacing:-.025em;text-wrap:balance;color:#1d1d1d}
.wild-note{margin:12px 2px 0;font-size:12px;color:#71717a}
.dark .wild-note{color:#a1a1aa}
`;
