import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Serverless by construction: the build is ONE self-contained index.html
// (scripts and styles inlined). It needs no web server of its own — open it
// from disk, IPFS, GitHub Pages or any static host. Its only network peer is
// the rnode HTTP API you point it at (rnode answers CORS with `*`).
export default defineConfig({
  base: "./",
  plugins: [preact(), viteSingleFile()],
  server: { port: 5180 },
});
