"use client";

import { type ElementType, type HTMLAttributes, type ReactNode, useEffect, useRef, useState } from "react";

/* Type that smears under the pointer. The text stays ordinary DOM text (selection, copy, find,
 * screen readers and print all use it); a canvas behind it draws the same words where the browser
 * set them, and a fragment shader drags that ink along the pointer's recent path.
 *
 * The trail is the last 32 samples of the stroke, each a position, a reach (the velocity scaled so
 * fast strokes reach far and slow ones barely) and a time. Each sample pulls the ink near it with a
 * Gaussian falloff that fades to nothing over `settle` ms, so the type comes back crisp by itself.
 * Time comes from performance.now and nothing is random, so the same strokes draw the same frames.
 *
 * Without WebGL2, with reduced motion or in forced colours it's the plain text. */

export type SmearProps = HTMLAttributes<HTMLElement> & {
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "div" | "blockquote" | "span";
  /** How far a fast stroke carries the ink; 1 reaches 1.6 brush widths. */
  strength?: number;
  /** The brush's width in px. Defaults to 1.1 × the font size. */
  radius?: number;
  /** How long a smear takes to settle back into crisp type, in ms. */
  settle?: number;
  /** How far past its box the ink may be dragged, in px. Defaults to 1.5 × the radius. */
  bleed?: number;
  /** The most device pixels per CSS pixel the canvas draws. */
  maxDpr?: number;
  /** The most pixels the canvas draws; past it the pixel ratio drops below `maxDpr`. */
  maxPixels?: number;
  children?: ReactNode;
};

const N = 32;
const TAPS = 24;
/** How far a full-speed stroke carries the ink, in brush widths, at strength 1. */
const REACH = 1.6;

const VERT = `#version 300 es
in vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
#define N ${N}
#define TAPS ${TAPS}
#define SPAN 0.45
uniform sampler2D uInk;   // the text, premultiplied, mipmapped; row 0 is the bottom
uniform vec2 uSize;       // backing px
uniform vec4 uTrail[N];   // xy the sample's position, zw its reach; device px, y up
uniform float uLife[N];   // how much of the sample is left, 0 when it has settled
uniform float uK;         // 2 / radius², so a sample's weight is e^(-2 (r / radius)²)
uniform float uMaxReach;
out vec4 outColor;

// Interleaved gradient noise: a fixed offset per pixel that breaks the taps' banding.
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

void main() {
  vec2 p = gl_FragCoord.xy;
  vec2 texel = 1.0 / uSize;
  vec2 D = vec2(0.0);
  float W = 0.0;
  for (int i = 0; i < N; i++) {
    float l = uLife[i];
    if (l <= 0.0) continue;
    vec2 q = p - uTrail[i].xy;
    float g = l * exp(-uK * dot(q, q));
    D += g * uTrail[i].zw;
    W += g;
  }
  // Where samples overlap they average; a lone fading one scales down.
  vec2 d = D / max(W, 1.0);
  float len = length(d);
  if (len > uMaxReach) { d *= uMaxReach / len; len = uMaxReach; }
  vec4 rest = textureLod(uInk, p * texel, 0.0);
  if (len < 0.5) { outColor = rest; return; }

  // The pixel shows the ink from behind it along the stroke, so the letters are carried with the
  // hand and stretched where the pull falls off; averaging the way back blurs them as they go,
  // with the same amount of ink.
  float n = clamp(ceil(len * SPAN / 3.0), 2.0, float(TAPS));
  float blur = max(0.0, log2(len * SPAN / n) - 0.5);
  float j = ign(p) - 0.5;
  vec4 ink = vec4(0.0);
  for (int k = 0; k < TAPS; k++) {
    if (float(k) >= n) break;
    float t = clamp((float(k) + 0.5 + j) / n, 0.0, 1.0);
    ink += textureLod(uInk, (p - d * (1.0 - SPAN * t)) * texel, blur);
  }
  outColor = mix(rest, ink / n, smoothstep(0.5, 3.0, len));
}`;

type Renderer = {
  setInk: (ink: HTMLCanvasElement) => void;
  draw: (trail: Float32Array, life: Float32Array, k: number, maxReach: number) => void;
  dispose: () => void;
};

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
  return s;
}

/** The program and its handles, or null when WebGL2 isn't there. */
function createRenderer(canvas: HTMLCanvasElement): Renderer | null {
  const gl = canvas.getContext("webgl2", {
    premultipliedAlpha: true,
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
  });
  if (!gl || gl.isContextLost()) return null;
  try {
    const prog = gl.createProgram()!;
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link");
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    gl.useProgram(prog);

    // One triangle that covers the viewport.
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    // Text on a transparent canvas filters wrongly unless it's premultiplied.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.uniform1i(gl.getUniformLocation(prog, "uInk"), 0);

    const uSize = gl.getUniformLocation(prog, "uSize");
    const uTrail = gl.getUniformLocation(prog, "uTrail");
    const uLife = gl.getUniformLocation(prog, "uLife");
    const uK = gl.getUniformLocation(prog, "uK");
    const uMaxReach = gl.getUniformLocation(prog, "uMaxReach");
    let inked = false;

    return {
      setInk(ink) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ink);
        gl.generateMipmap(gl.TEXTURE_2D);
        inked = true;
      },
      draw(trail, life, k, maxReach) {
        const w = canvas.width;
        const h = canvas.height;
        gl.viewport(0, 0, w, h);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (!inked) return;
        gl.uniform2f(uSize, w, h);
        gl.uniform4fv(uTrail, trail);
        gl.uniform1fv(uLife, life);
        gl.uniform1f(uK, k);
        gl.uniform1f(uMaxReach, maxReach);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      // The context stays: StrictMode runs effects twice on the same canvas.
      dispose() {
        gl.deleteTexture(tex);
        gl.deleteBuffer(buffer);
        gl.deleteProgram(prog);
      },
    };
  } catch (err) {
    console.warn("smear shader unavailable", err);
    return null;
  }
}

const fontOf = (st: CSSStyleDeclaration) => `${st.fontStyle} ${st.fontWeight} ${st.fontSize} ${st.fontFamily}`;

/** The text nodes that draw, skipping any <style> or <script> left inside. */
function* textNodes(root: HTMLElement) {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const parent = n.parentElement;
    if (parent && parent.tagName !== "STYLE" && parent.tagName !== "SCRIPT") yield n as Text;
  }
}

const graphemes = (text: string): string[] =>
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (s) => s.segment)
    : Array.from(text);

/** How far below a text range's top the baseline sits, for this element's font: measured once per
 * layout with a zero-height inline-block, which sits on the baseline, next to a letter. */
function baselineOf(st: CSSStyleDeclaration) {
  const line = document.createElement("span");
  line.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre";
  Object.assign(line.style, { fontStyle: st.fontStyle, fontWeight: st.fontWeight, fontSize: st.fontSize, fontFamily: st.fontFamily });
  const text = document.createTextNode("x");
  const probe = document.createElement("span");
  probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
  line.appendChild(text);
  line.appendChild(probe);
  document.body.appendChild(line);
  const range = document.createRange();
  range.selectNodeContents(text);
  const top = range.getClientRects()[0]?.top ?? 0;
  const base = probe.getBoundingClientRect().top;
  line.remove();
  return base - top;
}

/** Waits for the faces the text uses, so the first ink is in the right font. */
async function fontsFor(root: HTMLElement) {
  if (!document.fonts) return;
  const seen = new Map<string, string>();
  for (const node of textNodes(root)) {
    const font = fontOf(getComputedStyle(node.parentElement!));
    seen.set(font, (seen.get(font) ?? "") + node.data);
  }
  await Promise.all([...seen].map(([font, text]) => document.fonts.load(font, text).catch(() => [])));
}

type Sample = { x: number; y: number; rx: number; ry: number; t: number };
type Stroke = { id: number; x: number; y: number; t: number; vx: number; vy: number; px: number; py: number; pt: number };

const CSS = `
:where([data-slot=smear]){position:relative;isolation:isolate}
:where([data-slot=smear][data-state=live]){-webkit-text-fill-color:transparent}
:where([data-slot=smear])>canvas{position:absolute;pointer-events:none;z-index:-1;user-select:none;-webkit-user-select:none}
@media print{:where([data-slot=smear][data-state=live]){-webkit-text-fill-color:currentcolor}:where([data-slot=smear])>canvas{display:none}}
`;

export function Smear({
  as = "p",
  strength = 1,
  radius,
  settle = 900,
  bleed,
  maxDpr = 2,
  maxPixels = 8e6,
  children,
  ...rest
}: SmearProps) {
  const Tag = as as ElementType;
  const host = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Unknown on the server and on the first client render, so both render the plain text.
  const [calm, setCalm] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const [session, setSession] = useState(0);
  const [ready, setReady] = useState(false);
  const lastLoss = useRef(0);
  const opts = useRef({ strength, settle });
  useEffect(() => {
    opts.current = { strength, settle };
  });
  const on = calm === false && !failed;

  useEffect(() => {
    const media = [matchMedia("(prefers-reduced-motion: reduce)"), matchMedia("(forced-colors: active)")];
    const sync = () => setCalm(media.some((m) => m.matches));
    sync();
    for (const m of media) m.addEventListener("change", sync);
    return () => {
      for (const m of media) m.removeEventListener("change", sync);
    };
  }, []);

  useEffect(() => {
    if (!on) return;
    const el = host.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;
    const gl = createRenderer(canvas);
    if (!gl) {
      setFailed(true);
      return;
    }
    let disposed = false;
    const ink = document.createElement("canvas");
    // The canvas's layout size, its bleed and the brush in CSS px, and device px per CSS px.
    const box = { w: 0, h: 0, r: 0, dpr: 1 };

    const layout = () => {
      const size = parseFloat(getComputedStyle(el).fontSize) || 16;
      box.r = radius ?? size * 1.1;
      const b = Math.round(bleed ?? box.r * 1.5);
      canvas.style.left = canvas.style.top = `${-b}px`;
      canvas.style.width = canvas.style.height = `calc(100% + ${2 * b}px)`;
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      if (!w || !h) return false;
      const at = canvas.getBoundingClientRect();
      // On-screen px per layout px: CSS zoom or a scaled parent.
      const s = at.width / w || 1;
      let dpr = Math.min((window.devicePixelRatio || 1) * s, maxDpr);
      while (dpr > 0.5 && w * h * dpr * dpr > maxPixels) dpr *= 0.9;
      const W = Math.max(1, Math.round(w * dpr));
      const H = Math.max(1, Math.round(h * dpr));
      ink.width = W;
      ink.height = H;
      const ctx = ink.getContext("2d")!;
      ctx.setTransform(W / w, 0, 0, H / h, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.textBaseline = "alphabetic";
      if ("fontKerning" in ctx) ctx.fontKerning = "normal";
      const spaced = "letterSpacing" in ctx;
      const range = document.createRange();
      const ascents = new Map<string, number>();
      for (const node of textNodes(el)) {
        const st = getComputedStyle(node.parentElement!);
        if (st.visibility === "hidden") continue;
        const font = fontOf(st);
        ctx.font = font;
        ctx.fillStyle = st.color;
        const spacing = st.letterSpacing === "normal" ? "0px" : st.letterSpacing;
        if (spaced) ctx.letterSpacing = spacing;
        let ascent = ascents.get(font);
        if (ascent === undefined) ascents.set(font, (ascent = baselineOf(st)));
        const cased = (t: string) =>
          st.textTransform === "uppercase" ? t.toUpperCase() : st.textTransform === "lowercase" ? t.toLowerCase() : t;
        // Each word is drawn on the baseline the browser gave it.
        // The browser rounds each baseline to the device pixel grid, and paints the canvas from its
        // own corner rounded the same way, so the ink is placed between the two.
        const device = (window.devicePixelRatio || 1) * s;
        const snap = (v: number) => Math.round(v * device) / device;
        const put = (text: string, r: DOMRect) =>
          ctx.fillText(cased(text), (r.left - snap(at.left)) / s, (snap(r.top + ascent * s) - snap(at.top)) / s);
        for (const m of node.data.matchAll(/\S+/g)) {
          range.setStart(node, m.index);
          range.setEnd(node, m.index + m[0].length);
          const rects = range.getClientRects();
          if (rects.length === 1 && (spaced || spacing === "0px")) {
            put(m[0], rects[0]!);
            continue;
          }
          // A word broken across lines, or spacing the canvas can't do: a grapheme at a time.
          let i = m.index;
          for (const g of graphemes(m[0])) {
            range.setStart(node, i);
            range.setEnd(node, (i += g.length));
            const r = range.getClientRects()[0];
            if (r) put(g, r);
          }
        }
      }
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      gl.setInk(ink);
      Object.assign(box, { w, h, dpr: W / w });
      return true;
    };

    // The trail, oldest first.
    const ring: Sample[] = [];
    const trail = new Float32Array(N * 4);
    const life = new Float32Array(N);
    let stroke: Stroke | null = null;
    let raf = 0;
    let visible = false;

    const frame = () => {
      raf = 0;
      const now = performance.now();
      const n = ring.length;
      let alive = false;
      for (let i = 0; i < N; i++) {
        const q = ring[i];
        if (!q) {
          life[i] = 0;
          continue;
        }
        const a = (now - q.t) / opts.current.settle;
        const fade = a >= 1 ? 0 : a <= 0 ? 1 : (1 - a) ** 2 * (1 + 2 * a);
        // The oldest thin out before they're pushed off, so a full ring doesn't pop.
        life[i] = fade * Math.min(1, (i + N - n + 1) / 6);
        if (life[i]! > 0) alive = true;
        trail.set([q.x * box.dpr, canvas.height - q.y * box.dpr, q.rx * box.dpr, -q.ry * box.dpr], i * 4);
      }
      if (!alive) ring.length = 0;
      gl.draw(trail, life, 2 / (box.r * box.dpr) ** 2, opts.current.strength * REACH * box.r * box.dpr);
      canvas.toggleAttribute("data-moving", alive);
      if (alive && visible) raf = requestAnimationFrame(frame);
    };
    const wake = () => {
      if (!raf && visible) raf = requestAnimationFrame(frame);
    };
    const redraw = () => {
      cancelAnimationFrame(raf);
      frame();
    };

    const end = () => {
      stroke = null;
    };
    const move = (e: PointerEvent) => {
      if (!box.w) return;
      const at = canvas.getBoundingClientRect();
      const s = at.width / box.w || 1;
      // Fast hands arrive as one event per frame with the points between folded into it.
      const points = e.getCoalescedEvents?.() ?? [];
      const now = performance.now();
      let woke = false;
      for (const [i, p] of (points.length ? points : [e]).entries()) {
        // The folded points share the frame's time, spread evenly back over the last 8 ms.
        const t = now - (points.length ? (points.length - 1 - i) * (8 / points.length) : 0);
        woke = step(e.pointerId, (p.clientX - at.left) / s, (p.clientY - at.top) / s, t) || woke;
      }
      if (woke) wake();
    };
    const step = (id: number, x: number, y: number, t: number) => {
      if (x < 0 || y < 0 || x > box.w || y > box.h) {
        end();
        return false;
      }
      const spacing = Math.max(2, box.r / 2);
      if (!stroke || stroke.id !== id || t - stroke.t > 80) {
        stroke = { id, x, y, t, vx: 0, vy: 0, px: x, py: y, pt: t };
        return false;
      }
      const dt = Math.max(t - stroke.t, 1);
      const vx = stroke.vx + ((x - stroke.x) / dt - stroke.vx) * 0.6;
      const vy = stroke.vy + ((y - stroke.y) / dt - stroke.vy) * 0.6;
      const speed = Math.hypot(vx, vy);
      // Full reach from 2.2 px/ms; below that it falls off steeply, so a slow hand barely smears.
      const reach = opts.current.strength * REACH * box.r * Math.min(1, (speed / 2.2) ** 1.6);
      const k = speed > 1e-4 ? reach / speed : 0;
      // A sample every half brush along the way, so a fast stroke leaves an even trail.
      let d = Math.hypot(x - stroke.px, y - stroke.py);
      let pushed = 0;
      while (d >= spacing && pushed < 16) {
        const f = spacing / d;
        stroke.px += (x - stroke.px) * f;
        stroke.py += (y - stroke.py) * f;
        stroke.pt += (t - stroke.pt) * f;
        ring.push({ x: stroke.px, y: stroke.py, rx: vx * k, ry: vy * k, t: stroke.pt });
        if (ring.length > N) ring.shift();
        d -= spacing;
        pushed++;
      }
      if (pushed === 16) Object.assign(stroke, { px: x, py: y, pt: t });
      Object.assign(stroke, { x, y, t, vx, vy });
      return pushed > 0;
    };

    const listening = { on: false };
    const listen = (yes: boolean) => {
      if (listening.on === yes) return;
      listening.on = yes;
      const method = yes ? addEventListener : removeEventListener;
      method("pointermove", move as EventListener, { passive: true });
      for (const type of ["pointerdown", "pointerup", "pointercancel", "blur"]) method(type, end, { passive: true });
    };

    let pending = 0;
    const relayout = () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => {
        pending = 0;
        if (!disposed && layout()) redraw();
      });
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        visible = !!entry?.isIntersecting;
        listen(visible);
        if (visible) wake();
        else {
          cancelAnimationFrame(raf);
          raf = 0;
        }
      },
      { rootMargin: "64px" },
    );
    const ro = new ResizeObserver(relayout);
    const mo = new MutationObserver(relayout);
    let dpr: MediaQueryList | undefined;
    const onDpr = () => {
      watchDpr();
      relayout();
    };
    const watchDpr = () => {
      dpr?.removeEventListener("change", onDpr);
      dpr = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      dpr.addEventListener("change", onDpr);
    };
    const onLost = (e: Event) => {
      e.preventDefault();
      setReady(false);
      const now = performance.now();
      // Once, it starts again on a fresh canvas; twice within ten seconds, it stays plain text.
      if (lastLoss.current && now - lastLoss.current < 10_000) setFailed(true);
      else {
        lastLoss.current = now;
        setSession((n) => n + 1);
      }
    };

    void fontsFor(el).then(() => {
      if (disposed) return;
      layout();
      redraw();
      setReady(true);
      io.observe(canvas);
      ro.observe(el);
      mo.observe(el, { childList: true, characterData: true, subtree: true });
      document.fonts?.addEventListener("loadingdone", relayout);
      watchDpr();
    });
    canvas.addEventListener("webglcontextlost", onLost);

    return () => {
      disposed = true;
      listen(false);
      io.disconnect();
      ro.disconnect();
      mo.disconnect();
      document.fonts?.removeEventListener("loadingdone", relayout);
      dpr?.removeEventListener("change", onDpr);
      canvas.removeEventListener("webglcontextlost", onLost);
      cancelAnimationFrame(raf);
      cancelAnimationFrame(pending);
      gl.dispose();
      setReady(false);
    };
  }, [on, session, radius, bleed, maxDpr, maxPixels]);

  return (
    <Tag ref={host} data-slot="smear" data-state={ready ? "live" : "static"} {...rest}>
      <style href="smear" precedence="default">
        {CSS}
      </style>
      {children}
      {on ? (
        <canvas key={session} ref={canvasRef} aria-hidden data-slot="smear-canvas" data-ready={ready ? "" : undefined} />
      ) : null}
    </Tag>
  );
}
