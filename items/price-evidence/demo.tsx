import "@fontsource-variable/rubik";
import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Shader, shaderBackground } from "@danolekh/cardstock/shader";
import { Glass } from "./glass";
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

/** Behind the glass look: black, with a soft grey light drifting slowly (cardstock's mesh in
 * zinc greys) under a fine grid, whose lines are what the glass visibly bends. */
const BACKDROP = shaderBackground("mesh", {
  color: "#09090b",
  speed: 0.25,
  params: {
    colors: ["#050506", "#09090b", "#101013", "#18181c", "#2c2c32"],
    distortion: 0.6,
    swirl: 0.3,
    grain: 0.06,
  },
});

/** The listing's colours: shadcn tokens for the part, set per look. */
const TOKENS = {
  minimist:
    "[--background:#fff] [--border:#E4E4E7] [--foreground:#141413] [--muted-foreground:#71717A] [--muted:#F4F4F5] [--pe-accent:#141413] [--pe-axis:#9a9aa3] [--pe-band:rgba(20,20,19,.05)] [--popover-foreground:#141413] [--popover:#fff] [--ring:#141413] dark:[--background:#141413] dark:[--border:#27272A] dark:[--foreground:#FAFAF8] dark:[--muted-foreground:#A1A1AA] dark:[--muted:#27272A] dark:[--pe-accent:#FAFAF8] dark:[--pe-band:rgba(250,250,248,.07)] dark:[--popover-foreground:#FAFAF8] dark:[--popover:#18181B] dark:[--ring:#FAFAF8]",
  glass:
    "[--background:rgba(14,14,16,.92)] [--border:rgba(255,255,255,.3)] [--foreground:#fff] [--muted-foreground:rgba(255,255,255,.72)] [--muted:rgba(255,255,255,.14)] [--pe-accent:#fff] [--pe-axis:rgba(255,255,255,.72)] [--pe-band:rgba(255,255,255,.14)] [--popover-foreground:#fff] [--popover:rgba(255,255,255,.16)] [--ring:#fff]",
};

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
/** A photo in the air. `z` stacks them: the one in the hand or arriving is on top (3), one going
 * home in between (2), and one making room in the card below (1). */
type Flight = Box & { rot: number; lift: number; z: number };

const easeOut = (t: number) => 1 - (1 - t) ** 3;

export default function PriceEvidenceDemo({ look = "minimist" }: { look?: "minimist" | "glass" }) {
  const glass = look === "glass";
  const [phase, setPhase] = useState<Phase>("idle");
  const [item, setItem] = useState<Item | null>(null);
  // Photos over the page (held, or on their way to the card or home), by item id.
  const [flying, setFlying] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  // A photo held over a card that already has one: the card shows it faintly and makes room.
  const [intent, setIntent] = useState<Item | null>(null);
  const [still, setStill] = useState(false);

  const zone = useRef<HTMLDivElement>(null);
  const slots = useRef<Record<string, HTMLButtonElement | null>>({});
  const els = useRef<Record<string, HTMLDivElement | null>>({});
  // Where each photo in flight is, painted straight onto its element each frame.
  const boxes = useRef<Record<string, Flight>>({});
  const frames = useRef<Record<string, number>>({});
  // The item in the card, for callbacks that run after the render that made them.
  const current = useRef<Item | null>(null);
  const air = useRef(new Set<string>());
  const intentRef = useRef<Item | null>(null);
  // The photo that moved up out of the card to make room, while it waits there.
  const lifted = useRef<string | null>(null);
  const drag = useRef<{
    item: Item;
    from: "row" | "card";
    start: { x: number; y: number };
    at: { x: number; y: number };
    /** Where it was grabbed, as a share of its size, so the photo keeps it under the pointer. */
    grab: { x: number; y: number };
    moved: boolean;
    vel: number;
    last: { x: number; t: number };
  } | null>(null);
  const skipClick = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const sales = useMemo(() => (item ? demoSales(item.sales) : []), [item]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setStill(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => {
      mq.removeEventListener("change", update);
      Object.values(frames.current).forEach(cancelAnimationFrame);
      clearTimeout(timer.current);
    };
  }, []);

  const paint = (id: string) => {
    const el = els.current[id];
    const b = boxes.current[id];
    if (!el || !b) return;
    el.style.width = `${b.w}px`;
    el.style.height = `${b.h}px`;
    el.style.transform = `translate(${b.x}px, ${b.y}px) rotate(${b.rot}deg) scale(${1 + b.lift * 0.06})`;
    el.style.boxShadow = `0 ${4 + b.lift * 16}px ${10 + b.lift * 28}px -10px rgba(20,20,19,${0.18 + b.lift * 0.22})`;
    el.style.zIndex = String(2147483000 + b.z);
  };

  const boxOf = (el: Element | null | undefined): Box => {
    const r = el?.getBoundingClientRect();
    return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : { x: 0, y: 0, w: 0, h: 0 };
  };
  const home = (it: Item) => boxOf(slots.current[it.id]);
  /** Where the photo in the card goes to make room: half its size, riding over the card's top edge. */
  const room = (): Box => {
    const z = boxOf(zone.current);
    return { x: z.x + z.w * 0.25, y: z.y - z.h * 0.18, w: z.w * 0.5, h: z.h * 0.5 };
  };
  const inZone = (x: number, y: number) => {
    const b = boxOf(zone.current);
    return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  };

  /** Puts a photo over the page at `box`. */
  const launch = (id: string, box: Box, z = 3) => {
    cancelAnimationFrame(frames.current[id] ?? 0);
    boxes.current[id] = { ...box, rot: 0, lift: 0, z };
    air.current.add(id);
    setFlying((f) => (f.includes(id) ? f : [...f, id]));
  };
  const land = (id: string) => {
    cancelAnimationFrame(frames.current[id] ?? 0);
    air.current.delete(id);
    setFlying((f) => f.filter((x) => x !== id));
  };

  /** Moves a photo in flight from where it is to `to`, on a slight arc, then calls `done`. It
   * settles to `lift` (0 is resting flat, 1 is held). */
  const fly = (id: string, to: Box, ms: number, done: () => void, lift = 0) => {
    cancelAnimationFrame(frames.current[id] ?? 0);
    const from = { ...boxes.current[id]! };
    const start = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / ms);
      const e = easeOut(t);
      boxes.current[id] = {
        x: from.x + (to.x - from.x) * e,
        y: from.y + (to.y - from.y) * e - Math.sin(Math.PI * t) * 28,
        w: from.w + (to.w - from.w) * e,
        h: from.h + (to.h - from.h) * e,
        rot: from.rot * (1 - e),
        lift: from.lift + (lift - from.lift) * e,
        z: from.z,
      };
      paint(id);
      if (t < 1) frames.current[id] = requestAnimationFrame(step);
      else done();
    };
    frames.current[id] = requestAnimationFrame(step);
  };

  const show = (next: Item | null) => {
    current.current = next;
    setItem(next);
    clearTimeout(timer.current);
    if (!next) return setPhase("idle");
    setPhase(still ? "listing" : "reading");
    if (!still) timer.current = setTimeout(() => setPhase("listing"), READING_MS);
  };

  /** Sends the photo that was in the card home: from where it moved up to, if it made room. */
  const sendHome = (prev: Item) => {
    if (lifted.current === prev.id) lifted.current = null;
    else if (air.current.has(prev.id)) return;
    else launch(prev.id, boxOf(zone.current), 1);
    boxes.current[prev.id]!.z = 2;
    fly(prev.id, home(prev), 560, () => land(prev.id));
  };

  /** Another photo is on its way into a full card: the one there moves up to make room for it. */
  const makeRoom = (next: Item) => {
    const prev = current.current;
    if (!prev || prev.id === next.id || still || intentRef.current?.id === next.id) return;
    intentRef.current = next;
    setIntent(next);
    if (lifted.current !== prev.id) {
      if (!air.current.has(prev.id)) launch(prev.id, boxOf(zone.current), 1);
      lifted.current = prev.id;
    }
    fly(prev.id, room(), 300, () => {}, 0.7);
  };

  /** It went away again: the photo that made room settles back into the card. */
  const settle = () => {
    intentRef.current = null;
    setIntent(null);
    const prev = current.current;
    if (!prev || lifted.current !== prev.id) return;
    lifted.current = null;
    fly(prev.id, boxOf(zone.current), 280, () => land(prev.id));
  };

  /** A photo has reached the card: it's read, and whatever was there goes home. */
  const place = (next: Item) => {
    const prev = current.current;
    if (prev && prev.id !== next.id && !still) sendHome(prev);
    intentRef.current = null;
    setIntent(null);
    show(next);
    land(next.id);
  };

  const away = (it: Item) => current.current?.id === it.id || flying.includes(it.id);

  /** A tap or Enter on a photo in the row. */
  const add = (next: Item) => {
    if (away(next)) return;
    if (still) return show(next);
    makeRoom(next);
    launch(next.id, home(next));
    fly(next.id, boxOf(zone.current), 460, () => place(next));
  };

  const reset = () => {
    const prev = current.current;
    if (!prev) return;
    show(null);
    if (still) return;
    launch(prev.id, boxOf(zone.current), 2);
    fly(prev.id, home(prev), 520, () => land(prev.id));
  };

  const grab = (e: ReactPointerEvent<HTMLElement>, it: Item, from: "row" | "card") => {
    const r = e.currentTarget.getBoundingClientRect();
    drag.current = {
      item: it,
      from,
      start: { x: e.clientX, y: e.clientY },
      at: { x: e.clientX, y: e.clientY },
      grab: { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height },
      moved: false,
      vel: 0,
      last: { x: e.clientX, t: performance.now() },
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onRowDown = (e: ReactPointerEvent<HTMLButtonElement>, it: Item) => {
    if (e.button !== 0 || still || away(it)) return;
    grab(e, it, "row");
  };

  // The photo in the card can be picked up again: dropped outside, it goes home.
  const onCardDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const it = current.current;
    if (!it || e.button !== 0 || still || (e.target as Element).closest("button")) return;
    grab(e, it, "card");
  };

  const onMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y) < 5) return;
      d.moved = true;
      const id = d.item.id;
      if (d.from === "row") launch(id, home(d.item));
      else {
        launch(id, boxOf(zone.current));
        show(null);
      }
      // While it's held it shrinks to the size it has in the row, leans into the direction it's
      // moving and settles when it stops.
      const size = home(d.item);
      const hold = () => {
        const cur = drag.current;
        const b = boxes.current[id];
        if (!cur || cur.item.id !== id || !b) return;
        b.w += (size.w - b.w) * 0.2;
        b.h += (size.h - b.h) * 0.2;
        b.x = cur.at.x - cur.grab.x * b.w;
        b.y = cur.at.y - cur.grab.y * b.h;
        b.rot += (Math.max(-12, Math.min(12, cur.vel * 16)) - b.rot) * 0.18;
        b.lift += (1 - b.lift) * 0.25;
        cur.vel *= 0.86;
        paint(id);
        frames.current[id] = requestAnimationFrame(hold);
      };
      frames.current[id] = requestAnimationFrame(hold);
    }
    const now = performance.now();
    d.vel = (e.clientX - d.last.x) / Math.max(8, now - d.last.t);
    d.last = { x: e.clientX, t: now };
    d.at = { x: e.clientX, y: e.clientY };
    const inside = inZone(e.clientX, e.clientY);
    setOver(inside);
    if (d.from === "row") {
      if (inside) makeRoom(d.item);
      else if (intentRef.current) settle();
    }
  };

  const onUp = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    if (d.from === "row") skipClick.current = true;
    setOver(false);
    const id = d.item.id;
    if (inZone(e.clientX, e.clientY)) {
      // Let go over the card: the one that made room heads home now, from where it is.
      const prev = current.current;
      if (prev && prev.id !== id && lifted.current === prev.id) sendHome(prev);
      fly(id, boxOf(zone.current), 320, () => place(d.item));
    } else {
      if (intentRef.current) settle();
      fly(id, home(d.item), 460, () => land(id));
    }
  };

  const status =
    phase === "reading" ? "Reading the photo" : phase === "listing" && item ? `${item.title}, priced` : "";

  const photos = ITEMS.map((it) => {
    const gone = away(it);
    return (
      <div key={it.id} className="flex flex-col items-center gap-1.5">
        <button
          type="button"
          ref={(el) => {
            slots.current[it.id] = el;
          }}
          data-item={it.id}
          aria-label={`Add the photo of the ${it.title}`}
          aria-disabled={gone || undefined}
          onPointerDown={(e) => onRowDown(e, it)}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onClick={() => (skipClick.current ? (skipClick.current = false) : add(it))}
          className={
            glass
              ? "relative size-14 touch-none overflow-hidden rounded-[16px] shadow-[0_8px_20px_-10px_rgba(0,0,0,.55)] outline-none select-none focus-visible:ring-2 focus-visible:ring-white sm:size-16"
              : "relative size-16 touch-none overflow-hidden rounded-2xl bg-[#f0ebe1] outline-none select-none focus-visible:ring-2 focus-visible:ring-[#141413] focus-visible:ring-offset-2 sm:size-[76px] dark:bg-[#2a2620] dark:focus-visible:ring-[#FAFAF8]"
          }
          style={{ cursor: gone ? "default" : "grab" }}
        >
          <img src={it.photo} alt="" draggable={false} className="size-full object-cover" style={{ opacity: gone ? 0 : 1 }} />
          {gone ? (
            <span
              className={
                glass
                  ? "absolute inset-0 rounded-[16px] bg-white/[0.06] ring-1 ring-white/25 ring-inset"
                  : "absolute inset-0 rounded-2xl border-[1.5px] border-dashed border-[#d4d4d8] dark:border-[#3f3f46]"
              }
            />
          ) : null}
        </button>
        {glass ? null : <span className="text-xs text-[#71717A] dark:text-[#A1A1AA]">{it.label}</span>}
      </div>
    );
  });

  const chip = (label: string) =>
    glass ? (
      <Glass radius={999} bezel={10} depth={4} tint="rgba(255,255,255,0.16)" className="absolute bottom-3 left-3">
        <span className="block px-3 py-1 text-xs font-medium text-white">{label}</span>
      </Glass>
    ) : (
      <span className="absolute bottom-3 left-3 rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-[#141413] shadow-sm backdrop-blur">
        {label}
      </span>
    );

  const resetButton = (
    <button
      type="button"
      onClick={reset}
      data-slot="mnm-reset"
      className={
        glass
          ? "block cursor-pointer px-3 py-1 text-xs font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          : "mnm-rise absolute bottom-3 left-3 cursor-pointer rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-[#141413] shadow-sm backdrop-blur transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      }
    >
      Try another item
    </button>
  );

  const card = (
    <>
      <div
        ref={zone}
        data-slot="mnm-zone"
        data-over={over || undefined}
        onPointerDown={onCardDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className={`mnm-zone relative aspect-[4/3] touch-pan-y overflow-hidden select-none sm:aspect-auto sm:h-full ${glass ? "rounded-[22px]" : "rounded-2xl"}`}
        style={{ cursor: item && phase !== "idle" ? "grab" : undefined }}
      >
        {intent ? (
          <img
            src={intent.photo}
            alt=""
            draggable={false}
            data-slot="mnm-intent"
            className="mnm-rise absolute inset-0 size-full object-cover opacity-45"
          />
        ) : item && phase !== "idle" ? (
          <>
            <img src={item.photo} alt={item.alt} draggable={false} className="absolute inset-0 size-full object-cover" />
            {phase === "reading" ? (
              <>
                <span className="absolute inset-0 bg-[#141413]/10" />
                <span className="mnm-scan" />
                {chip("Reading the photo…")}
              </>
            ) : glass ? (
              <Glass radius={999} bezel={10} depth={4} tint="rgba(255,255,255,0.16)" className="mnm-rise absolute bottom-3 left-3">
                {resetButton}
              </Glass>
            ) : (
              resetButton
            )}
          </>
        ) : (
          <div
            className={
              glass
                ? "mnm-well absolute inset-0 grid place-items-center rounded-[22px] px-4 text-center"
                : "mnm-drop absolute inset-0 grid place-items-center rounded-2xl border-[1.5px] border-dashed px-4 text-center"
            }
          >
            <div>
              <span
                className={`mx-auto grid size-9 place-items-center rounded-full ${glass ? "bg-white/15" : "bg-[#141413]/[0.06] dark:bg-white/[0.08]"}`}
              >
                <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />
                </svg>
              </span>
              <p className="mt-2 text-sm font-medium">Drop a photo of an item</p>
            </div>
          </div>
        )}
      </div>

      <div style={{ opacity: intent ? 0.4 : 1, transition: "opacity 200ms" }} className={`min-w-0 ${TOKENS[look]}`}>
        {phase === "listing" && item ? (
          <>
            <div className="mnm-rise" key={item.id}>
              <p className="truncate text-lg leading-snug font-medium">{item.title}</p>
              <p className={`truncate text-sm ${glass ? "text-white/70" : "text-[#71717A] dark:text-[#A1A1AA]"}`}>
                {item.details}
              </p>
            </div>
            <PriceEvidence key={item.id} sales={sales} ratio={RATIO} className="mt-5" />
          </>
        ) : (
          <Skeleton glass={glass} />
        )}
      </div>
    </>
  );

  return (
    <div
      className={
        glass
          ? "mnm-demo mnm-glass relative isolate overflow-hidden rounded-[28px] bg-[#09090b] p-4 text-white sm:p-8"
          : "mnm-demo rounded-[28px] bg-[#FAFAF8] p-3 text-[#141413] sm:p-6 dark:bg-[#0E0E10] dark:text-[#FAFAF8]"
      }
      data-phase={phase}
      data-look={look}
    >
      <style href="mnm-demo" precedence="default">
        {CSS}
      </style>
      {glass ? (
        <div aria-hidden data-slot="mnm-backdrop" className="pointer-events-none absolute inset-0 -z-10">
          <Shader value={BACKDROP} play="always" />
          <div className="mnm-grid absolute inset-0" />
          <div className="mnm-spot absolute inset-0" />
        </div>
      ) : null}

      {glass ? (
        <div className="flex justify-center" data-slot="mnm-tray">
          <Glass radius={30} bezel={20} depth={8} tint="rgba(255,255,255,0.10)" className="flex gap-3 p-2.5 sm:gap-3.5 sm:p-3">
            {photos}
          </Glass>
        </div>
      ) : (
        <div className="flex justify-center gap-3 sm:gap-4" data-slot="mnm-tray">
          {photos}
        </div>
      )}

      {glass ? (
        <Glass
          radius={34}
          bezel={30}
          depth={12}
          tint="rgba(10,10,12,0.42)"
          className="mt-5 grid gap-5 p-4 sm:grid-cols-[5fr_7fr] sm:p-6"
        >
          {card}
        </Glass>
      ) : (
        <div className="mt-4 grid gap-5 rounded-3xl border border-[#E4E4E7] bg-white p-4 shadow-[0_1px_2px_rgba(20,20,19,.04),0_12px_32px_-12px_rgba(20,20,19,.12)] sm:grid-cols-[5fr_7fr] sm:p-6 dark:border-[#27272A] dark:bg-[#141413]">
          {card}
        </div>
      )}

      <p className={glass ? "mt-4 px-2 text-center text-xs text-white/75" : "mt-3 px-2 text-xs text-[#71717A] dark:text-[#A1A1AA]"}>
        {glass ? "A design concept for Minimist" : "A design concept in Minimist's style"}, not affiliated with
        Minimist. Photos from Unsplash; the sales are made up.
      </p>

      <p className="sr-only" aria-live="polite">
        {status}
      </p>

      {typeof document !== "undefined"
        ? flying.map((id) => {
            const it = ITEMS.find((x) => x.id === id)!;
            return createPortal(
              <div
                key={id}
                ref={(el) => {
                  els.current[id] = el;
                  paint(id);
                }}
                aria-hidden
                data-slot="mnm-ghost"
                className={`pointer-events-none fixed top-0 left-0 overflow-hidden ${glass ? "rounded-[16px] ring-1 ring-white/45" : "rounded-2xl"}`}
              >
                <img src={it.photo} alt="" className="size-full object-cover" />
              </div>,
              document.body,
              id,
            );
          })
        : null}
    </div>
  );
}

/** The listing before there is one: the same lines at the same heights, as faint bars. */
function Skeleton({ glass }: { glass: boolean }) {
  const label = glass ? "text-white/50" : "text-[#a1a1aa] dark:text-[#52525b]";
  const faint = glass ? "text-white/30" : "text-[#d4d4d8] dark:text-[#3f3f46]";
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
            <p className={`text-sm ${label}`}>Suggested price</p>
            <p className={`mt-1 text-[1.75rem] leading-tight font-semibold tracking-tight sm:text-3xl ${faint}`}>
              £?? – £??
            </p>
          </div>
          <div className="flex items-center gap-2 pb-1">
            <p className={`text-sm ${faint}`}>Based on … similar sales</p>
            <span className="size-7" />
          </div>
        </div>
        <div className="mt-4 flex items-end" style={{ aspectRatio: `640 / ${RATIO * 640 + 2}` }}>
          <span className={`block h-px w-full ${glass ? "bg-white/25" : "bg-[#e4e4e7] dark:bg-[#27272a]"}`} />
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
@media (prefers-reduced-motion:reduce){.mnm-scan,.mnm-bar,.mnm-rise{animation:none!important}.mnm-scan{display:none}}
.mnm-grid{background-image:linear-gradient(rgba(255,255,255,.085) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.085) 1px,transparent 1px);background-size:32px 32px;background-position:center;-webkit-mask-image:radial-gradient(ellipse 75% 70% at 50% 45%,#000 35%,transparent 85%);mask-image:radial-gradient(ellipse 75% 70% at 50% 45%,#000 35%,transparent 85%)}
.mnm-spot{background:radial-gradient(ellipse 55% 45% at 50% -8%,rgba(255,255,255,.16),rgba(255,255,255,.05) 45%,transparent 75%)}
.mnm-demo.mnm-glass,.mnm-demo.mnm-glass *{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Helvetica Neue",system-ui,sans-serif}
.mnm-glass .mnm-well{background:rgba(255,255,255,.07);box-shadow:inset 0 0 0 1px rgba(255,255,255,.22);color:#fff;transition:background-color .15s,box-shadow .15s,transform .2s}
.mnm-glass .mnm-zone[data-over] .mnm-well{background:rgba(255,255,255,.14);box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.75);transform:scale(.985)}
.mnm-glass .mnm-bar{background-image:linear-gradient(90deg,rgba(255,255,255,.13) 0%,rgba(255,255,255,.13) 35%,rgba(255,255,255,.3) 50%,rgba(255,255,255,.13) 65%,rgba(255,255,255,.13) 100%)}
.mnm-glass .pe-plot .z-10{border-radius:999px;border-color:rgba(255,255,255,.35);background:rgba(255,255,255,.16);backdrop-filter:blur(16px) saturate(1.6);-webkit-backdrop-filter:blur(16px) saturate(1.6);box-shadow:inset 0 1px 0 rgba(255,255,255,.4),0 8px 24px -8px rgba(0,0,0,.45)}
.mnm-glass [data-slot=price-evidence-replay]:hover{background:rgba(255,255,255,.14)}
`;
