"use client";

import { type CSSProperties, type HTMLAttributes, useEffect, useId, useRef, useState } from "react";

/* A glass surface in the manner of Apple's Liquid Glass, after Aave's write-up
 * (aave.com/design/building-glass-for-the-web): the backdrop is bent at the rounded edges by an SVG
 * feDisplacementMap whose map is drawn from the surface's own shape, with a faint colour fringe and
 * a specular rim. Content inside stays ordinary DOM.
 *
 * The bending needs SVG filters in backdrop-filter, which only Chromium draws. Elsewhere, and when
 * the viewer asks for less transparency, it's a frosted panel with the same rim. */

export type GlassProps = HTMLAttributes<HTMLDivElement> & {
  radius?: number;
  /** How far in from the edge the glass curves, in px. */
  bezel?: number;
  /** How far the backdrop moves at the very edge, in px. */
  depth?: number;
  /** Colour fringe: the red and blue channels bend this share more and less than green. */
  chroma?: number;
  /** Where the light comes from, in degrees (45 is the top left). */
  specular?: number;
  /** How bright the rim is, 0 to 1. */
  highlight?: number;
  /** A blur under the glass, in px. */
  frost?: number;
  tint?: string;
};

type Maps = { id: string; w: number; h: number; map: string; rim: string };

const chromium = () =>
  typeof navigator !== "undefined" && /Chrome\/\d+/.test(navigator.userAgent) && !/Firefox/.test(navigator.userAgent);

/** Draws the displacement map and the rim for a rounded rectangle, one quadrant mirrored into four. */
function draw(w: number, h: number, radius: number, bezel: number, specular: number, highlight: number, res: number) {
  // Drawn at `res` device pixels per CSS pixel, so the rim stays crisp; all distances are in CSS px.
  const W = Math.max(2, Math.round(w * res));
  const H = Math.max(2, Math.round(h * res));
  const map = new ImageData(W, H);
  const rim = new ImageData(W, H);
  const hw = w / 2;
  const hh = h / 2;
  const r = Math.min(radius, hw, hh);
  const a = (specular * Math.PI) / 180;
  // Light from the top left at 45°, in screen coordinates (y points down).
  const lx = -Math.cos(a);
  const ly = -Math.sin(a);
  const rimWidth = 2.2;

  for (let y = 0; y < Math.ceil(H / 2); y++) {
    for (let x = 0; x < Math.ceil(W / 2); x++) {
      // Distance from the edge, measured from the centre so one quadrant covers all four.
      const ax = hw - (x + 0.5) / res;
      const ay = hh - (y + 0.5) / res;
      const qx = ax - (hw - r);
      const qy = ay - (hh - r);
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
      const inside = -outside;
      let nx = 0;
      let ny = 0;
      if (qx > 0 && qy > 0) {
        const len = Math.hypot(qx, qy) || 1;
        nx = qx / len;
        ny = qy / len;
      } else if (qx > qy) nx = 1;
      else ny = 1;

      // A convex bezel: the bend is strongest right at the edge and gone past the bezel.
      const t = inside <= 0 ? 1 : Math.min(1, inside / bezel);
      const bend = inside <= 0 ? 0 : (1 - t) ** 2;
      const edge = inside <= 0 ? 0 : Math.max(0, 1 - inside / rimWidth);
      const glow = inside <= 0 ? 0 : (1 - t) ** 3;

      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const) {
        const px = sx < 0 ? x : W - 1 - x;
        const py = sy < 0 ? y : H - 1 - y;
        const i = (py * W + px) * 4;
        // The normal points out of this quadrant's corner; the backdrop is sampled from further in.
        const onx = sx * nx;
        const ony = sy * ny;
        map.data[i] = 128 - 127 * onx * bend;
        map.data[i + 1] = 128 - 127 * ony * bend;
        map.data[i + 2] = 128;
        map.data[i + 3] = 255;
        const facing = onx * lx + ony * ly;
        const lit = Math.max(facing, 0) ** 1.5 + 0.45 * Math.max(-facing, 0) ** 1.5;
        const alpha = Math.min(1, highlight * (edge * (0.4 + 0.6 * lit) + glow * lit * 0.5));
        rim.data[i] = 255;
        rim.data[i + 1] = 255;
        rim.data[i + 2] = 255;
        rim.data[i + 3] = Math.round(alpha * 255);
      }
    }
  }

  const url = (data: ImageData) => {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    canvas.getContext("2d")!.putImageData(data, 0, 0);
    return canvas.toDataURL("image/png");
  };
  return { map: url(map), rim: url(rim) };
}

let serial = 0;

export function Glass({
  radius = 28,
  bezel = 24,
  depth = 10,
  chroma = 0.2,
  specular = 45,
  highlight = 0.6,
  frost = 0,
  tint = "rgba(255,255,255,0.06)",
  className,
  style,
  children,
  ...rest
}: GlassProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Only word characters, so the id works inside url(#…) on every React 19 (19.1's ids are «r0»).
  const base = useId().replace(/[^\w-]/g, "");
  const [maps, setMaps] = useState<Maps | null>(null);
  const [plain, setPlain] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-transparency: reduce)");
    let frame = 0;
    let ro: ResizeObserver | undefined;
    const build = () => {
      // Layout size, not the on-screen one: the filter works in the element's own CSS pixels.
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (!w || !h) return;
      const { map, rim } = draw(w, h, radius, bezel, specular, highlight, Math.min(window.devicePixelRatio || 1, 2.5));
      // A new id per size, so a browser that caches filters by id picks the new one up.
      setMaps({ id: `glass-${base}-${++serial}`, w, h, map, rim });
    };
    // Also runs when the viewer changes the transparency setting while the page is open.
    const sync = () => {
      ro?.disconnect();
      ro = undefined;
      cancelAnimationFrame(frame);
      if (!chromium() || reduced.matches) return setPlain(true);
      setPlain(false);
      ro = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(build);
      });
      ro.observe(el);
    };
    sync();
    reduced.addEventListener("change", sync);
    return () => {
      reduced.removeEventListener("change", sync);
      ro?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [base, radius, bezel, specular, highlight]);

  const rimShadow = "inset 0 1px 0 rgba(255,255,255,.45), inset 0 0 0 1px rgba(255,255,255,.16)";
  const surface: CSSProperties =
    plain || !maps
      ? {
          backdropFilter: `blur(${Math.max(frost, 14)}px) saturate(1.6)`,
          WebkitBackdropFilter: `blur(${Math.max(frost, 14)}px) saturate(1.6)`,
          boxShadow: `${rimShadow}, 0 18px 50px -20px rgba(0,0,0,.45)`,
        }
      : {
          backdropFilter: `${frost ? `blur(${frost}px) ` : ""}url(#${maps.id}) saturate(1.5)`,
          boxShadow: "0 18px 50px -20px rgba(0,0,0,.45)",
        };
  // Deeper than this and the lens folds over itself near the rim (the bend's slope passes 1), which
  // smears instead of bending.
  const scale = Math.min(depth, bezel * 0.45) * 2;

  return (
    <div
      ref={ref}
      data-glass={plain || !maps ? "plain" : "bent"}
      className={className}
      style={{ borderRadius: radius, background: tint, ...surface, ...style }}
      {...rest}
    >
      {maps && !plain ? (
        <svg aria-hidden width="0" height="0" style={{ position: "absolute" }}>
          <filter
            id={maps.id}
            x="0"
            y="0"
            width={maps.w}
            height={maps.h}
            filterUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feImage href={maps.map} x="0" y="0" width={maps.w} height={maps.h} preserveAspectRatio="none" result="map" />
            <feDisplacementMap in="SourceGraphic" in2="map" scale={scale * (1 + chroma / 2)} xChannelSelector="R" yChannelSelector="G" result="dr" />
            <feColorMatrix in="dr" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
            <feDisplacementMap in="SourceGraphic" in2="map" scale={scale} xChannelSelector="R" yChannelSelector="G" result="dg" />
            <feColorMatrix in="dg" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
            <feDisplacementMap in="SourceGraphic" in2="map" scale={scale * (1 - chroma / 2)} xChannelSelector="R" yChannelSelector="G" result="db" />
            <feColorMatrix in="db" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
            <feComposite in="r" in2="g" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="rg" />
            <feComposite in="rg" in2="b" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="rgb" />
            <feImage href={maps.rim} x="0" y="0" width={maps.w} height={maps.h} preserveAspectRatio="none" result="rim" />
            <feBlend in="rim" in2="rgb" mode="screen" />
          </filter>
        </svg>
      ) : null}
      {children}
    </div>
  );
}
