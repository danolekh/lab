import "@fontsource-variable/rubik";
import { type CSSProperties, useMemo } from "react";
import { PriceEvidence, type Sale } from "./price-evidence";

/* The concept, in Minimist's style: a charity shop prices a donated waxed jacket, and the 215 sales
 * the price is based on are there to see. The sales are made up (a seeded log-normal around £41,
 * spread over the last 90 days); a design concept, not affiliated with Minimist. */

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function demoSales(count = 215, seed = 7): Sale[] {
  const rand = mulberry32(seed);
  const normal = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const today = Date.UTC(2026, 8, 27);
  const channels = ["eBay", "eBay", "eBay", "Vinted", "Vinted", "Depop"];
  const conditions = ["Good", "Very good", "Very good", "Excellent"];
  return Array.from({ length: count }, () => {
    const price = Math.min(79, Math.max(19, 41 * Math.exp(0.13 * normal())));
    // Most second-hand prices end in .00, .50 or .99.
    const ending = [0, 0.5, -0.01][Math.floor(rand() * 3)]!;
    return {
      price: Math.round(price) + ending,
      soldAt: new Date(today - Math.floor(rand() * 90) * 86_400_000).toISOString().slice(0, 10),
      channel: channels[Math.floor(rand() * channels.length)],
      condition: conditions[Math.floor(rand() * conditions.length)],
    };
  });
}

const THEME = {
  "--pe-accent": "#7676BF",
  "--pe-axis": "#9a9aa3",
} as CSSProperties;

export default function PriceEvidenceDemo() {
  const sales = useMemo(() => demoSales(), []);
  return (
    <div className="mnm-demo rounded-[28px] bg-[#FAFAF8] p-3 text-[#141413] sm:p-6 dark:bg-[#0E0E10] dark:text-[#FAFAF8]">
      {/* Unlayered, so it wins over a host page's own `* { font-family }`. */}
      <style href="mnm-demo" precedence="default">
        {`.mnm-demo,.mnm-demo *{font-family:"Rubik Variable",Rubik,sans-serif}`}
      </style>
      <div className="rounded-3xl border border-[#E4E4E7] bg-white p-5 shadow-[0_1px_2px_rgba(20,20,19,.04),0_12px_32px_-12px_rgba(20,20,19,.12)] sm:p-7 dark:border-[#27272A] dark:bg-[#141413]">
        <p className="text-[11px] font-semibold tracking-[0.14em] text-[#7676BF] uppercase">Pricing</p>
        <div className="mt-3 flex items-center gap-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#f0ebe1] text-[#6b5a45] dark:bg-[#2a2620] dark:text-[#d9ccb8]">
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden>
              <path d="M9 3.5 12 5l3-1.5 4.5 2.5 1.5 5.5-2.5 1V21h-13v-8.5l-2.5-1L4.5 6z" />
              <path d="M12 5v16M9 3.5 12 8l3-4.5" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium">Men's waxed cotton jacket, M</p>
            <p className="text-sm text-[#71717A] dark:text-[#A1A1AA]">Olive · Very good · donated today</p>
          </div>
        </div>
        <div className="mt-6 [--background:#fff] [--border:#E4E4E7] [--foreground:#141413] [--muted-foreground:#71717A] [--muted:#F4F4F5] [--popover-foreground:#141413] [--popover:#fff] [--ring:#7676BF] dark:[--background:#141413] dark:[--border:#27272A] dark:[--foreground:#FAFAF8] dark:[--muted-foreground:#A1A1AA] dark:[--muted:#27272A] dark:[--popover-foreground:#FAFAF8] dark:[--popover:#18181B]">
          <PriceEvidence sales={sales} style={THEME} />
        </div>
      </div>
      <p className="mt-3 px-2 text-xs text-[#71717A] dark:text-[#A1A1AA]">
        A design concept in Minimist's style, not affiliated with Minimist. The sales are made up.
      </p>
    </div>
  );
}
