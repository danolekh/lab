import "@fontsource-variable/rubik";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { PriceEvidence, type Sale } from "./price-evidence";

/* The concept, in Minimist's style: a charity shop drops in a photo of a donated item and gets the
 * listing back, with the sales its price is based on. The photos are CC0 from Unsplash (photos.md);
 * the sales are made up (seeded log-normals over the last 90 days). Not affiliated with Minimist.
 *
 * Dragging is pointer events rather than HTML drag and drop, so it works on touch and shows up in a
 * screenshot (the promo recorder films it). */

type Item = {
  id: string;
  photo: string;
  alt: string;
  label: string;
  title: string;
  details: string;
  sales: { count: number; center: number; spread: number; seed: number };
};

const PHOTOS = "/images/lab/price-evidence";

export const ITEMS: Item[] = [
  {
    id: "bag",
    photo: `${PHOTOS}/bag.webp`,
    alt: "A brown leather weekend bag",
    label: "Bags",
    title: "Leather weekend bag, brown",
    details: "Leather · two front pockets · Very good",
    sales: { count: 215, center: 42, spread: 0.19, seed: 7 },
  },
  {
    id: "boots",
    photo: `${PHOTOS}/boots.webp`,
    alt: "Tan leather chukka boots",
    label: "Shoes",
    title: "Leather chukka boots, UK 9",
    details: "Tan · dark laces · Good",
    sales: { count: 138, center: 27, spread: 0.2, seed: 11 },
  },
  {
    id: "camera",
    photo: `${PHOTOS}/camera.webp`,
    alt: "A Kodak Duaflex II camera",
    label: "Cameras",
    title: "Kodak Duaflex II camera",
    details: "1950s · untested · Good",
    sales: { count: 64, center: 23, spread: 0.3, seed: 5 },
  },
];

/** The plot's height as a share of its width, the same for every item so the card keeps its size. */
const RATIO = 0.42;
const READING_MS = 1200;

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function demoSales({ count, center, spread, seed }: Item["sales"]): Sale[] {
  const rand = mulberry32(seed);
  const normal = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const today = Date.UTC(2026, 8, 27);
  const channels = ["eBay", "eBay", "eBay", "Vinted", "Vinted", "Depop"];
  const conditions = ["Good", "Very good", "Very good", "Excellent"];
  return Array.from({ length: count }, () => {
    const price = Math.min(center * 2, Math.max(center * 0.45, center * Math.exp(spread * normal())));
    // Most second-hand prices end in .00, .50 or .99.
    const ending = [0, 0.5, -0.01][Math.floor(rand() * 3)]!;
    return {
      price: Math.max(1, Math.round(price)) + ending,
      soldAt: new Date(today - Math.floor(rand() * 90) * 86_400_000).toISOString().slice(0, 10),
      channel: channels[Math.floor(rand() * channels.length)],
      condition: conditions[Math.floor(rand() * conditions.length)],
    };
  });
}

type Phase = "idle" | "reading" | "listing";
type Box = { x: number; y: number; w: number; h: number };

const easeOut = (t: number) => 1 - (1 - t) ** 3;

export default function PriceEvidenceDemo() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [item, setItem] = useState<Item | null>(null);
  const [ghost, setGhost] = useState<Item | null>(null);
  const [over, setOver] = useState(false);
  const [still, setStill] = useState(false);

  const zone = useRef<HTMLDivElement>(null);
  const slots = useRef<Record<string, HTMLButtonElement | null>>({});
  const ghostEl = useRef<HTMLDivElement>(null);
  // Where the photo in flight is, painted straight onto its element each frame.
  const g = useRef({ x: 0, y: 0, w: 0, h: 0, rot: 0, lift: 0 });
  const drag = useRef<{
    item: Item;
    from: { x: number; y: number };
    grab: { x: number; y: number };
    moved: boolean;
    vel: number;
    last: { x: number; t: number };
  } | null>(null);
  const skipClick = useRef(false);
  const frame = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const sales = useMemo(() => (item ? demoSales(item.sales) : []), [item]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setStill(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => {
      mq.removeEventListener("change", update);
      cancelAnimationFrame(frame.current);
      clearTimeout(timer.current);
    };
  }, []);

  const paint = () => {
    const el = ghostEl.current;
    if (!el) return;
    const { x, y, w, h, rot, lift } = g.current;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg) scale(${1 + lift * 0.06})`;
    el.style.boxShadow = `0 ${4 + lift * 16}px ${10 + lift * 28}px -10px rgba(20,20,19,${0.18 + lift * 0.22})`;
  };
  useLayoutEffect(paint, [ghost]);

  const boxOf = (el: Element | null | undefined): Box => {
    const r = el?.getBoundingClientRect();
    return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : { x: 0, y: 0, w: 0, h: 0 };
  };
  const inZone = (x: number, y: number) => {
    const b = boxOf(zone.current);
    return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  };

  /** Moves the photo in flight from where it is to `to`, on a slight arc, then calls `done`. */
  const fly = (to: Box, done: () => void, ms = 460) => {
    cancelAnimationFrame(frame.current);
    const from = { ...g.current };
    const start = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / ms);
      const e = easeOut(t);
      g.current = {
        x: from.x + (to.x - from.x) * e,
        y: from.y + (to.y - from.y) * e - Math.sin(Math.PI * t) * 28,
        w: from.w + (to.w - from.w) * e,
        h: from.h + (to.h - from.h) * e,
        rot: from.rot * (1 - e),
        lift: from.lift * (1 - e),
      };
      paint();
      if (t < 1) frame.current = requestAnimationFrame(step);
      else done();
    };
    frame.current = requestAnimationFrame(step);
  };

  const read = (next: Item) => {
    setItem(next);
    setGhost(null);
    setPhase(still ? "listing" : "reading");
    clearTimeout(timer.current);
    if (!still) timer.current = setTimeout(() => setPhase("listing"), READING_MS);
  };

  const add = (next: Item) => {
    if (phase !== "idle") return;
    if (still) return read(next);
    g.current = { ...boxOf(slots.current[next.id]), rot: 0, lift: 0 };
    setGhost(next);
    fly(boxOf(zone.current), () => read(next));
  };

  const reset = () => {
    if (!item) return;
    const back = item;
    clearTimeout(timer.current);
    setPhase("idle");
    setItem(null);
    if (still) return;
    g.current = { ...boxOf(zone.current), rot: 0, lift: 0 };
    setGhost(back);
    fly(boxOf(slots.current[back.id]), () => setGhost(null), 520);
  };

  const onDown = (e: ReactPointerEvent<HTMLButtonElement>, next: Item) => {
    if (phase !== "idle" || e.button !== 0 || still) return;
    const r = e.currentTarget.getBoundingClientRect();
    drag.current = {
      item: next,
      from: { x: e.clientX, y: e.clientY },
      grab: { x: e.clientX - r.left, y: e.clientY - r.top },
      moved: false,
      vel: 0,
      last: { x: e.clientX, t: performance.now() },
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.from.x, e.clientY - d.from.y) < 5) return;
      d.moved = true;
      g.current = { ...boxOf(slots.current[d.item.id]), rot: 0, lift: 0 };
      setGhost(d.item);
      // While it's held, it leans into the direction it's moving and settles when it stops.
      const tilt = () => {
        const cur = drag.current;
        if (!cur) return;
        const target = Math.max(-12, Math.min(12, cur.vel * 16));
        g.current.rot += (target - g.current.rot) * 0.18;
        g.current.lift += (1 - g.current.lift) * 0.25;
        cur.vel *= 0.86;
        paint();
        frame.current = requestAnimationFrame(tilt);
      };
      frame.current = requestAnimationFrame(tilt);
    }
    const now = performance.now();
    d.vel = (e.clientX - d.last.x) / Math.max(8, now - d.last.t);
    d.last = { x: e.clientX, t: now };
    g.current.x = e.clientX - d.grab.x;
    g.current.y = e.clientY - d.grab.y;
    paint();
    setOver(inZone(e.clientX, e.clientY));
  };

  const onUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    skipClick.current = true;
    setOver(false);
    if (inZone(e.clientX, e.clientY)) fly(boxOf(zone.current), () => read(d.item), 320);
    else fly(boxOf(slots.current[d.item.id]), () => setGhost(null), 420);
  };

  const status =
    phase === "reading" ? "Reading the photo" : phase === "listing" && item ? `${item.title}, priced` : "";

  return (
    <div
      className="mnm-demo rounded-[28px] bg-[#FAFAF8] p-3 text-[#141413] sm:p-6 dark:bg-[#0E0E10] dark:text-[#FAFAF8]"
      data-phase={phase}
    >
      <style href="mnm-demo" precedence="default">
        {CSS}
      </style>

      <div className="flex justify-center gap-3 sm:gap-4" data-slot="mnm-tray">
        {ITEMS.map((it) => {
          const away = item?.id === it.id || ghost?.id === it.id;
          return (
            <div key={it.id} className="flex flex-col items-center gap-1.5">
              <button
                type="button"
                ref={(el) => {
                  slots.current[it.id] = el;
                }}
                data-item={it.id}
                aria-label={`Add the photo of the ${it.title}`}
                disabled={phase !== "idle"}
                onPointerDown={(e) => onDown(e, it)}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                onClick={() => (skipClick.current ? (skipClick.current = false) : add(it))}
                className="relative size-16 touch-none overflow-hidden rounded-2xl bg-[#f0ebe1] outline-none select-none focus-visible:ring-2 focus-visible:ring-[#141413] focus-visible:ring-offset-2 sm:size-[76px] dark:bg-[#2a2620] dark:focus-visible:ring-[#FAFAF8]"
                style={{ cursor: phase === "idle" ? "grab" : "default" }}
              >
                <img
                  src={it.photo}
                  alt=""
                  draggable={false}
                  className="size-full object-cover transition-opacity duration-200"
                  style={{ opacity: away ? 0 : 1 }}
                />
                {away ? (
                  <span className="absolute inset-0 rounded-2xl border-[1.5px] border-dashed border-[#d4d4d8] dark:border-[#3f3f46]" />
                ) : null}
              </button>
              <span className="text-xs text-[#71717A] dark:text-[#A1A1AA]">{it.label}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-4 grid gap-5 rounded-3xl border border-[#E4E4E7] bg-white p-4 shadow-[0_1px_2px_rgba(20,20,19,.04),0_12px_32px_-12px_rgba(20,20,19,.12)] sm:grid-cols-[5fr_7fr] sm:p-6 dark:border-[#27272A] dark:bg-[#141413]">
        <div
          ref={zone}
          data-slot="mnm-zone"
          data-over={over || undefined}
          className="mnm-zone relative aspect-[4/3] overflow-hidden rounded-2xl sm:aspect-auto sm:h-full"
        >
          {item && phase !== "idle" ? (
            <>
              <img src={item.photo} alt={item.alt} className="absolute inset-0 size-full object-cover" />
              {phase === "reading" ? (
                <>
                  <span className="absolute inset-0 bg-[#141413]/10" />
                  <span className="mnm-scan" />
                  <span className="absolute bottom-3 left-3 rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-[#141413] shadow-sm backdrop-blur">
                    Reading the photo…
                  </span>
                </>
              ) : (
                <button
                  type="button"
                  onClick={reset}
                  data-slot="mnm-reset"
                  className="mnm-rise absolute bottom-3 left-3 rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-[#141413] shadow-sm backdrop-blur transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  Try another item
                </button>
              )}
            </>
          ) : (
            <div className="mnm-drop absolute inset-0 grid place-items-center rounded-2xl border-[1.5px] border-dashed px-4 text-center">
              <div>
                <span className="mx-auto grid size-9 place-items-center rounded-full bg-[#141413]/[0.06] dark:bg-white/[0.08]">
                  <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />
                  </svg>
                </span>
                <p className="mt-2 text-sm font-medium">Drop a photo of an item</p>
              </div>
            </div>
          )}
        </div>

        <div className="min-w-0 [--background:#fff] [--border:#E4E4E7] [--foreground:#141413] [--muted-foreground:#71717A] [--muted:#F4F4F5] [--pe-accent:#141413] [--pe-axis:#9a9aa3] [--pe-band:rgba(20,20,19,.05)] [--popover-foreground:#141413] [--popover:#fff] [--ring:#141413] dark:[--background:#141413] dark:[--border:#27272A] dark:[--foreground:#FAFAF8] dark:[--muted-foreground:#A1A1AA] dark:[--muted:#27272A] dark:[--pe-accent:#FAFAF8] dark:[--pe-band:rgba(250,250,248,.07)] dark:[--popover-foreground:#FAFAF8] dark:[--popover:#18181B] dark:[--ring:#FAFAF8]">
          {phase === "listing" && item ? (
            <>
              <div className="mnm-rise">
                <p className="truncate text-lg leading-snug font-medium">{item.title}</p>
                <p className="truncate text-sm text-[#71717A] dark:text-[#A1A1AA]">{item.details}</p>
              </div>
              <PriceEvidence key={item.id} sales={sales} ratio={RATIO} className="mt-5" />
            </>
          ) : (
            <Skeleton />
          )}
        </div>
      </div>

      <p className="mt-3 px-2 text-xs text-[#71717A] dark:text-[#A1A1AA]">
        A design concept in Minimist's style, not affiliated with Minimist. Photos from Unsplash; the
        sales are made up.
      </p>

      <p className="sr-only" aria-live="polite">
        {status}
      </p>

      {ghost && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={ghostEl}
              aria-hidden
              data-slot="mnm-ghost"
              className="pointer-events-none fixed top-0 left-0 z-[2147483001] overflow-hidden rounded-2xl"
            >
              <img src={ghost.photo} alt="" className="size-full object-cover" />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/** The listing before there is one: the same lines at the same heights, as faint bars. */
function Skeleton() {
  return (
    <div aria-hidden>
      <p className="text-lg leading-snug">
        <span className="mnm-bar inline-block h-[0.8em] w-3/5 rounded-full align-middle" />
      </p>
      <p className="text-sm">
        <span className="mnm-bar inline-block h-[0.75em] w-2/5 rounded-full align-middle" />
      </p>
      <div className="mt-5">
        <div className="flex flex-col items-start gap-y-1">
          <div>
            <p className="text-sm text-[#a1a1aa] dark:text-[#52525b]">Suggested price</p>
            <p className="mt-1 text-[1.75rem] leading-tight font-semibold tracking-tight text-[#d4d4d8] sm:text-3xl dark:text-[#3f3f46]">
              £?? – £??
            </p>
          </div>
          <div className="flex items-center gap-2 pb-1">
            <p className="text-sm text-[#d4d4d8] dark:text-[#3f3f46]">Based on … similar sales</p>
            <span className="size-7" />
          </div>
        </div>
        <div className="mt-4 flex items-end" style={{ aspectRatio: `640 / ${RATIO * 640 + 2}` }}>
          <span className="block h-px w-full bg-[#e4e4e7] dark:bg-[#27272a]" />
        </div>
        <div className="h-6" />
      </div>
    </div>
  );
}

const CSS = `
.mnm-demo,.mnm-demo *{font-family:"Rubik Variable",Rubik,sans-serif}
.mnm-drop{border-color:#d4d4d8;background:#fafafa;color:#141413;transition:border-color .15s,background-color .15s,transform .2s}
.dark .mnm-drop{border-color:#3f3f46;background:#18181b;color:#fafaf8}
.mnm-zone[data-over] .mnm-drop{border-style:solid;border-color:#141413;background:#f4f4f5;transform:scale(.985)}
.dark .mnm-zone[data-over] .mnm-drop{border-color:#fafaf8;background:#27272a}
.mnm-scan{position:absolute;left:0;right:0;top:0;height:45%;background:linear-gradient(to bottom,rgba(255,255,255,0),rgba(255,255,255,.5) 55%,rgba(255,255,255,0));transform:translateY(-100%);animation:mnm-scan ${READING_MS - 150}ms cubic-bezier(.45,0,.25,1) both}
@keyframes mnm-scan{to{transform:translateY(222%)}}
.mnm-bar{background:linear-gradient(90deg,#f0f0f1 0%,#f0f0f1 35%,#fafafa 50%,#f0f0f1 65%,#f0f0f1 100%);background-size:250% 100%}
.dark .mnm-bar{background-image:linear-gradient(90deg,#222225 0%,#222225 35%,#2d2d31 50%,#222225 65%,#222225 100%)}
.mnm-demo[data-phase=reading] .mnm-bar{animation:mnm-shimmer 1000ms linear infinite}
@keyframes mnm-shimmer{from{background-position:100% 0}to{background-position:-150% 0}}
.mnm-demo [data-slot=price-evidence]>div:first-child{flex-direction:column;align-items:flex-start}
.mnm-rise{animation:mnm-rise 420ms cubic-bezier(.2,.8,.2,1) both}
@keyframes mnm-rise{from{opacity:0;transform:translateY(6px)}}
@media (prefers-reduced-motion:reduce){.mnm-scan,.mnm-bar,.mnm-demo [data-slot=price-evidence]>div:first-child{flex-direction:column;align-items:flex-start}
.mnm-rise{animation:none!important}.mnm-scan{display:none}}
`;
