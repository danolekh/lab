"use client";

import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

/* A suggested price with its evidence: every similar sale is a dot, stacked by price, and the
 * suggested range sits over the thickest part. On first view the sales drop in one by one, the
 * count ticks up as they land, and the range settles and claims its dots. Point at any dot (or use
 * the arrow keys) to see that sale.
 *
 * Colours come from shadcn tokens. To restyle, set `--pe-accent`, `--pe-dot`, `--pe-band` or
 * `--pe-axis` on it or on any parent (a `dark:` class works too). */

export type Sale = {
  /** What it sold for, in the currency's main unit (41.5 is £41.50). */
  price: number;
  /** ISO date of the sale. */
  soldAt: string;
  /** Where it sold, e.g. "eBay". */
  channel?: string;
  /** The item's condition when it sold. */
  condition?: string;
};

export type PriceEvidenceProps = {
  sales: Sale[];
  /** The suggested range, inclusive. Defaults to the middle half of the sales, in whole units. */
  range?: [number, number];
  currency?: string;
  locale?: string;
  /** Width of one column of dots, in currency units. */
  step?: number;
  /** Drop the sales in on first view. Off (and under reduced motion) they are shown in place. */
  animate?: boolean;
  /** The plot's height as a share of its width. Dots shrink to fit it; without it, the plot is as
   *  tall as its tallest column needs. */
  ratio?: number;
  label?: string;
  basis?: (count: number) => string;
  className?: string;
  style?: CSSProperties;
};

const W = 640;
const PAD_X = 10;
const TOP = 16;
const DROP_MS = 640;
const STAGGER_MS = 1300;
const BAND_MS = 520;

type Dot = {
  sale: Sale;
  x: number;
  y: number;
  r: number;
  /** When it starts to fall and when it lands, in ms from the start. */
  delay: number;
  lands: number;
  inRange: boolean;
  tint: number;
};

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quantile(sorted: number[], q: number) {
  const i = (sorted.length - 1) * q;
  const lo = sorted[Math.floor(i)] ?? 0;
  const hi = sorted[Math.ceil(i)] ?? lo;
  return lo + (hi - lo) * (i - Math.floor(i));
}

function tickStep(span: number) {
  const raw = span / 5;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * pow;
}

function layout(sales: Sale[], step: number, given?: [number, number], ratio?: number) {
  const prices = sales.map((s) => s.price).sort((a, b) => a - b);
  // Columns are centred on multiples of `step`, so £37.99 counts as £38, the way people read it.
  const snap = (price: number) => Math.round(price / step) * step;
  const lo = snap(prices[0] ?? 0);
  const hi = snap(prices.at(-1) ?? 0);
  const cols = Math.round((hi - lo) / step) + 1;
  const colW = (W - 2 * PAD_X) / cols;
  const range: [number, number] = given ?? [snap(quantile(prices, 0.25)), snap(quantile(prices, 0.75))];
  const colOf = (price: number) => Math.round((snap(price) - lo) / step);
  const xOf = (price: number) => PAD_X + ((price - lo) / step + 0.5) * colW;

  // Sales arrive in a random (but stable) order, and each lands on top of its column's stack.
  const rand = mulberry32(sales.length * 9973 + 17);
  const order = sales.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const heights = new Array<number>(cols).fill(0);
  const placed = order.map((i, k) => {
    const sale = sales[i]!;
    const col = colOf(sale.price);
    return { sale, col, h: heights[col]!++, k };
  });
  const tallest = Math.max(1, ...heights);
  // Dots are as big as the columns allow. With a fixed `ratio` the plot keeps its height, and the
  // dots shrink until the tallest column fits (a pitch of 2r plus a gap of 0.35r, at least 1).
  const fit = ratio ? (ratio * W - TOP) / tallest : Infinity;
  const r = Math.min(colW * 0.4, 6, fit >= 1 / 0.35 * 2.35 ? fit / 2.35 : (fit - 1) / 2);
  const pitch = r * 2 + Math.max(1, r * 0.35);
  const baseline = ratio ? ratio * W : TOP + tallest * pitch;
  const bandLeft = xOf(range[0]) - colW / 2;
  const bandRight = xOf(range[1]) + colW / 2;
  const mid = (bandLeft + bandRight) / 2;
  const bandAt = STAGGER_MS + DROP_MS * 0.55;

  const dots: Dot[] = placed.map(({ sale, col, h, k }) => {
    const x = PAD_X + (col + 0.5) * colW;
    const delay = (k / sales.length) * STAGGER_MS;
    const inRange = col >= colOf(range[0]) && col <= colOf(range[1]);
    return {
      sale,
      x,
      y: baseline - r - h * pitch,
      r,
      delay,
      lands: delay + DROP_MS * 0.5,
      inRange,
      // The range claims its dots from the middle out as it opens.
      tint: bandAt + (Math.abs(x - mid) / Math.max(1, (bandRight - bandLeft) / 2)) * BAND_MS * 0.6,
    };
  });

  const every = tickStep(hi - lo);
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / every) * every; t <= hi; t += every) ticks.push(t);

  return {
    dots,
    range,
    ticks,
    xOf,
    baseline,
    band: { left: bandLeft, right: bandRight, at: bandAt },
    byPrice: dots
      .map((_, i) => i)
      .sort((a, b) => dots[a]!.sale.price - dots[b]!.sale.price || dots[b]!.y - dots[a]!.y),
  };
}

type Phase = "idle" | "playing";

export function PriceEvidence({
  sales,
  range: givenRange,
  currency = "GBP",
  locale = "en-GB",
  step = 1,
  animate = true,
  ratio,
  label = "Suggested price",
  basis = (n) => `Based on ${n} similar ${n === 1 ? "sale" : "sales"}`,
  className,
  style,
}: PriceEvidenceProps) {
  const plot = useMemo(() => layout(sales, step, givenRange, ratio), [sales, step, givenRange, ratio]);
  const whole = useMemo(
    () => new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }),
    [locale, currency],
  );
  const exact = useMemo(
    () => new Intl.NumberFormat(locale, { style: "currency", currency }),
    [locale, currency],
  );
  const day = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }),
    [locale],
  );

  const root = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [run, setRun] = useState(0);
  const [still, setStill] = useState(!animate);
  const [landed, setLanded] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const liveId = useId();

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setStill(!animate || mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [animate]);

  // Start on first view; a replay goes back to idle for a frame so the animations restart.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (still) {
      setPhase("playing");
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        io.disconnect();
        setPhase("playing");
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [still, run]);

  // The count ticks up as the sales land.
  useEffect(() => {
    if (phase !== "playing") return setLanded(0);
    if (still) return setLanded(plot.dots.length);
    const lands = plot.dots.map((d) => d.lands).sort((a, b) => a - b);
    const start = performance.now();
    let frame = 0;
    const tick = () => {
      const t = performance.now() - start;
      let n = 0;
      while (n < lands.length && lands[n]! <= t) n++;
      setLanded(n);
      if (n < lands.length) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase, still, plot, run]);

  const replay = () => {
    setActive(null);
    setPhase("idle");
    requestAnimationFrame(() => requestAnimationFrame(() => setRun((r) => r + 1)));
  };

  const done = phase === "playing" && landed === plot.dots.length;

  const nearest = (e: PointerEvent<HTMLDivElement>) => {
    const box = (e.currentTarget.querySelector("svg") ?? e.currentTarget).getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * W;
    const y = ((e.clientY - box.top) / box.height) * (plot.baseline + 2);
    let best: number | null = null;
    let bestD = (plot.dots[0]?.r ?? 6) * 6;
    plot.dots.forEach((d, i) => {
      const dist = Math.hypot(d.x - x, d.y - y);
      if (dist < bestD) [best, bestD] = [i, dist];
    });
    return best;
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const order = plot.byPrice;
    const at = active === null ? -1 : order.indexOf(active);
    const move = (to: number) => {
      e.preventDefault();
      setActive(order[Math.max(0, Math.min(order.length - 1, to))] ?? null);
    };
    if (e.key === "ArrowRight" || e.key === "ArrowUp") move(at < 0 ? order.length >> 1 : at + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") move(at < 0 ? order.length >> 1 : at - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(order.length - 1);
    else if (e.key === "Escape") setActive(null);
  };

  const dot = active === null ? null : plot.dots[active];
  const describe = (s: Sale) =>
    [
      Number.isInteger(s.price) ? whole.format(s.price) : exact.format(s.price),
      s.channel,
      day.format(new Date(s.soldAt)),
      s.condition,
    ]
      .filter(Boolean)
      .join(" · ");

  const [from, to] = plot.range;
  const prices = plot.byPrice.map((i) => plot.dots[i]!.sale.price);
  const summary = `${plot.dots.length} recent sales from ${whole.format(prices[0] ?? 0)} to ${whole.format(
    prices.at(-1) ?? 0,
  )}. Half of them sold between ${whole.format(from)} and ${whole.format(to)}.`;

  return (
    <div
      ref={root}
      data-slot="price-evidence"
      data-phase={phase}
      data-still={still || undefined}
      className={["pe-root text-foreground", className].filter(Boolean).join(" ")}
      style={style}
    >
      <style href="price-evidence" precedence="default">
        {CSS}
      </style>

      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="pe-price mt-1 text-[1.75rem] leading-tight font-semibold tracking-tight whitespace-nowrap tabular-nums sm:text-3xl">
            <Roll value={from} format={whole} on={phase === "playing"} at={plot.band.at} />
            <span className="mx-1.5 text-muted-foreground">–</span>
            <Roll value={to} format={whole} on={phase === "playing"} at={plot.band.at + 90} />
            <span className="sr-only">
              {whole.format(from)} to {whole.format(to)}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2 pb-1">
          <p className="text-sm whitespace-nowrap text-muted-foreground tabular-nums" aria-hidden>
            {basis(landed)}
          </p>
          {still ? null : (
            <button
              type="button"
              onClick={replay}
              aria-label="Replay"
              data-slot="price-evidence-replay"
              className="grid size-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M2.5 8a5.5 5.5 0 1 0 1.7-3.97" />
                <path d="M2.5 2.5v2.8h2.8" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div
        className="pe-plot relative mt-4 touch-none rounded-md outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        tabIndex={0}
        role="group"
        aria-label={summary}
        aria-describedby={liveId}
        aria-roledescription="dot plot"
        onPointerMove={(e) => done && setActive(nearest(e))}
        onPointerDown={(e) => done && setActive(nearest(e))}
        onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
      >
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${plot.baseline + 2}`} className="block h-auto w-full overflow-hidden text-muted-foreground" aria-hidden>
            <rect
              className="pe-band"
              x={plot.band.left}
              y={TOP - 8}
              width={plot.band.right - plot.band.left}
              height={plot.baseline - TOP + 8}
              rx={6}
              style={{ "--at": `${plot.band.at}ms` } as CSSProperties}
            />
            <g key={run}>
              {plot.dots.map((d, i) => (
                <circle
                  key={i}
                  className="pe-dot"
                  data-in={d.inRange || undefined}
                  cx={d.x}
                  cy={d.y}
                  r={d.r}
                  style={
                    {
                      "--from": `${-(d.y + d.r + 4)}px`,
                      "--d": `${d.delay}ms`,
                      "--tint": `${d.tint}ms`,
                    } as CSSProperties
                  }
                />
              ))}
            </g>
            <line x1={PAD_X} x2={W - PAD_X} y1={plot.baseline + 1} y2={plot.baseline + 1} stroke="currentColor" strokeOpacity={0.35} />
            {dot ? (
              <g className="pe-active">
                <line x1={dot.x} x2={dot.x} y1={dot.y + dot.r * 1.8} y2={plot.baseline} stroke="currentColor" strokeDasharray="2 3" />
                <circle cx={dot.x} cy={dot.y} r={dot.r * 1.75} className="pe-ring" />
              </g>
            ) : null}
          </svg>
          {dot ? (
            <div
              className="pointer-events-none absolute z-10 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs whitespace-nowrap text-popover-foreground shadow-sm"
              style={{
                left: `${(dot.x / W) * 100}%`,
                top: `${(dot.y / (plot.baseline + 2)) * 100}%`,
                transform: `translate(${dot.x / W < 0.15 ? "-12%" : dot.x / W > 0.85 ? "-88%" : "-50%"}, calc(-100% - 14px))`,
              }}
            >
              <span className="font-semibold tabular-nums">
                {Number.isInteger(dot.sale.price) ? whole.format(dot.sale.price) : exact.format(dot.sale.price)}
              </span>
              <span className="text-muted-foreground">
                {" · "}
                {[dot.sale.channel, day.format(new Date(dot.sale.soldAt)), dot.sale.condition].filter(Boolean).join(" · ")}
              </span>
            </div>
          ) : null}
        </div>

        <div className="relative h-6 text-xs text-muted-foreground tabular-nums" aria-hidden>
          {plot.ticks.map((t) => (
            <span
              key={t}
              className="absolute top-1.5 -translate-x-1/2"
              style={{ left: `${(plot.xOf(t) / W) * 100}%` }}
            >
              {whole.format(t)}
            </span>
          ))}
        </div>

        <p id={liveId} className="sr-only" aria-live="polite">
          {dot ? describe(dot.sale) : ""}
        </p>
      </div>
    </div>
  );
}

/** A number whose digits roll up from "?" to their value. */
function Roll({ value, format, on, at }: { value: number; format: Intl.NumberFormat; on: boolean; at: number }) {
  let n = 0;
  return (
    <span className="inline-flex items-baseline" aria-hidden>
      {format.formatToParts(value).map((part, i) =>
        part.type === "integer" ? (
          [...part.value].map((ch, j) => {
            const k = n++;
            return (
              <span key={`${i}-${j}`} className="pe-digit-box">
                <span
                  className="pe-digit"
                  style={{
                    transform: `translateY(${on ? -(Number(ch) + 1) * 1.2 : 0}em)`,
                    transitionDelay: `${at + k * 70}ms`,
                  }}
                >
                  {DIGITS.map((d) => (
                    <span key={d}>{d}</span>
                  ))}
                </span>
              </span>
            );
          })
        ) : (
          <span key={i}>{part.value}</span>
        ),
      )}
    </span>
  );
}

const DIGITS = ["?", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

const CSS = `
.pe-root{--pe-a:var(--pe-accent,var(--primary));--pe-d:var(--pe-dot,color-mix(in oklab,currentColor 30%,transparent));--pe-b:var(--pe-band,color-mix(in oklab,var(--pe-a) 13%,transparent));--pe-ease:linear(0,.06 12.5%,.25 25%,.56 37.5%,1 50%,.955 58%,.94 63%,.955 68%,1 76%,.992 86%,1)}
.pe-root .pe-plot svg{color:var(--pe-axis,var(--muted-foreground))}
.pe-dot{fill:var(--pe-d)}
.pe-dot[data-in]{fill:var(--pe-a)}
.pe-root[data-phase=idle] .pe-dot{transform:translateY(var(--from))}
.pe-root[data-phase=playing] .pe-dot{animation:pe-drop ${DROP_MS}ms var(--pe-ease) var(--d) both}
.pe-root[data-phase=playing] .pe-dot[data-in]{animation:pe-drop ${DROP_MS}ms var(--pe-ease) var(--d) both,pe-tint 380ms ease-out var(--tint) both}
.pe-band{fill:var(--pe-b);transform-box:fill-box;transform-origin:center}
.pe-root[data-phase=idle] .pe-band{transform:scaleX(0);opacity:0}
.pe-root[data-phase=playing] .pe-band{animation:pe-band ${BAND_MS}ms cubic-bezier(.2,.8,.2,1) var(--at) both}
.pe-ring{fill:var(--pe-a);stroke:var(--background,#fff);stroke-width:2.5}
.pe-digit-box{display:inline-block;height:1.2em;line-height:1.2em;overflow:hidden;-webkit-mask-image:linear-gradient(transparent,#000 16%,#000 80%,transparent);mask-image:linear-gradient(transparent,#000 16%,#000 80%,transparent)}
.pe-digit{display:flex;flex-direction:column;text-align:center;transition:transform 820ms cubic-bezier(.16,1,.3,1)}
.pe-digit>span{display:block;height:1.2em}
.pe-root[data-phase=idle] .pe-digit{transition:none}
@keyframes pe-drop{from{transform:translateY(var(--from))}to{transform:translateY(0)}}
@keyframes pe-tint{from{fill:var(--pe-d)}to{fill:var(--pe-a)}}
@keyframes pe-band{from{transform:scaleX(0);opacity:0}to{transform:scaleX(1);opacity:1}}
.pe-root[data-still] .pe-dot,.pe-root[data-still] .pe-band{animation:none!important;transform:none!important;opacity:1}
.pe-root[data-still] .pe-digit{transition:none}
`;
