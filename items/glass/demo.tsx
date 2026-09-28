import { type CSSProperties, type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import { Glass } from "./glass";

/* One lens over big type on a black stage, after Aave's write-up
 * (aave.com/design/building-glass-for-the-web). The backdrop is still, so the promo clip loops as
 * it is.
 *
 * The lens's place is kept as a share of the room it has to move in (0 to 1 each way), so it stays
 * inside the stage, holds its spot when the stage resizes, and renders in place on the server. */

type At = { x: number; y: number };
type Drag = { id: number; x0: number; y0: number; from: At; now: At; fw: number; fh: number };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export default function GlassDemo() {
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [at, setAt] = useState<At>({ x: 0.5, y: 0.5 });

  // The room the lens has, in layout px.
  const room = (lens: HTMLElement) => {
    const s = stage.current!;
    return { fw: Math.max(1, s.clientWidth - lens.offsetWidth), fh: Math.max(1, s.clientHeight - lens.offsetHeight) };
  };
  // While dragging, the position goes straight to the stage's variables, with no render per move.
  const place = (f: At) => {
    stage.current!.style.setProperty("--fx", String(f.x));
    stage.current!.style.setProperty("--fy", String(f.y));
  };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const lens = e.currentTarget;
    lens.setPointerCapture(e.pointerId);
    lens.dataset.dragging = "";
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, from: at, now: at, ...room(lens) };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    d.now = { x: clamp01(d.from.x + (e.clientX - d.x0) / d.fw), y: clamp01(d.from.y + (e.clientY - d.y0) / d.fh) };
    place(d.now);
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    delete e.currentTarget.dataset.dragging;
    setAt(d.now);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 32 : 8;
    const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
    const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    const { fw, fh } = room(e.currentTarget);
    setAt((a) => ({ x: clamp01(a.x + dx / fw), y: clamp01(a.y + dy / fh) }));
  };

  return (
    <div data-slot="glass-demo" className="glass-demo">
      <style href="glass-demo" precedence="default">
        {CSS}
      </style>
      <div
        ref={stage}
        data-slot="glass-stage"
        className="glass-stage"
        style={{ "--fx": at.x, "--fy": at.y } as CSSProperties}
      >
        <div aria-hidden className="glass-grid" />
        <div aria-hidden className="glass-spot" />
        <p className="glass-type">
          <span>Liquid</span> <span>Glass</span>
        </p>
        <Glass
          data-slot="glass-lens"
          className="glass-lens"
          tabIndex={0}
          role="application"
          aria-roledescription="lens"
          aria-label="Glass lens. The arrow keys move it, Shift moves it further."
          radius={999}
          bezel={30}
          depth={13}
          chroma={0.08}
          highlight={0.7}
          tint="rgba(255,255,255,0.03)"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onLostPointerCapture={up}
          onKeyDown={key}
        />
      </div>
    </div>
  );
}

const CSS = `
.glass-demo{container-type:inline-size}
.glass-stage{position:relative;isolation:isolate;overflow:hidden;border-radius:28px;background:#09090b;height:clamp(380px,56.25cqi,560px);--lens-w:260px;--lens-h:140px}
@container (max-width:480px){.glass-stage{--lens-w:180px;--lens-h:100px}}
.glass-grid,.glass-spot,.glass-type{position:absolute;inset:0;pointer-events:none}
.glass-grid{background-image:linear-gradient(rgba(255,255,255,.085) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.085) 1px,transparent 1px);background-size:32px 32px;background-position:center;-webkit-mask-image:radial-gradient(ellipse 75% 70% at 50% 45%,#000 35%,transparent 85%);mask-image:radial-gradient(ellipse 75% 70% at 50% 45%,#000 35%,transparent 85%)}
.glass-spot{background:radial-gradient(ellipse 55% 45% at 50% -8%,rgba(255,255,255,.16),rgba(255,255,255,.05) 45%,transparent 75%)}
.glass-type{display:flex;flex-direction:column;align-items:center;justify-content:center;margin:0;color:#fff;font:700 clamp(60px,20cqi,190px)/.88 -apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",system-ui,sans-serif;letter-spacing:-.045em;text-align:center;user-select:none;-webkit-user-select:none}
.glass-type span{display:block;font-family:inherit}
.glass-lens{position:absolute;left:calc((100% - var(--lens-w)) * var(--fx));top:calc((100% - var(--lens-h)) * var(--fy));width:var(--lens-w);height:var(--lens-h);cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;outline:none}
.glass-lens[data-dragging]{cursor:grabbing}
.glass-lens:focus-visible{outline:2px solid rgba(255,255,255,.9);outline-offset:4px}
`;
