import { StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

// Every item's demo, newest first; `?item=<slug>` shows one alone (the promo recorder films that).
const demos = import.meta.glob<{ default: ComponentType<{ look?: string }> }>("../items/*/demo.tsx", {
  eager: true,
});
const items = Object.entries(demos)
  .map(([path, mod]) => ({ slug: path.split("/").at(-2)!, Demo: mod.default }))
  .reverse();
const params = new URLSearchParams(location.search);
const only = params.get("item");
// `?look=glass`: a demo's other look, if it has one.
const look = params.get("look") ?? undefined;

function Playground() {
  const shown = only ? items.filter((i) => i.slug === only) : items;
  return (
    <main className="mx-auto max-w-3xl space-y-16 px-4 py-10">
      {shown.map(({ slug, Demo }) => (
        <section key={slug} data-item={slug}>
          {only ? null : <h2 className="mb-4 font-mono text-sm text-muted-foreground">{slug}</h2>}
          <Demo look={look} />
        </section>
      ))}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Playground />
  </StrictMode>,
);
