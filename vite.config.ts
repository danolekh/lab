import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The playground: every item's demo on one page, `?item=<slug>` for one alone.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 4180 },
});
