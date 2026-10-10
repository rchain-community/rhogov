import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { execSync } from "node:child_process";

// Which build this is: the commit (CI gives GITHUB_SHA), else the time. Baked
// into the page as __BUILD__ and published beside it as version.json, so an
// open page can notice a newer deploy and offer to reload.
const BUILD = (() => {
  try { return (process.env.GITHUB_SHA ?? execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString()).trim().slice(0, 7); }
  catch { return new Date().toISOString(); }
})();

// Serverless by construction: the build is ONE self-contained index.html
// (scripts and styles inlined). It needs no web server of its own — open it
// from disk, IPFS, GitHub Pages or any static host. Its only network peer is
// the rnode HTTP API you point it at (rnode answers CORS with `*`).
export default defineConfig({
  base: "./",
  define: { __BUILD__: JSON.stringify(BUILD) },
  plugins: [preact(), viteSingleFile(), {
    name: "version-file",
    generateBundle() { this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: BUILD }) + "\n" }); },
  }],
  server: { port: 5180 },
});
