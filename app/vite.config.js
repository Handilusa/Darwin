import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "../web");
const DEPLOYMENTS = path.resolve(HERE, "../contracts/deployments");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8",
};

/**
 *  Serves `web/` at /arena — verbatim, byte for byte, never through the bundler.
 *
 *  This is the whole reason the two surfaces can share a design system without the
 *  dashboard losing what makes it worth showing. `web/` has no build step, no install
 *  and no framework: it is ES modules a browser loads directly, and its README claims
 *  as much. Import it into Vite's graph and that claim quietly stops being true — the
 *  judge would be looking at a bundle. So it is copied, not compiled.
 *
 *  In dev it is streamed off disk on every request, so editing web/app.css and
 *  reloading works exactly as it did before this app existed. In build it is copied
 *  into dist/arena/ so one `npm run build` produces one deployable directory.
 */
function arena() {
  const send = (res, file) => {
    res.setHeader("Content-Type", MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream");
    // No caching in dev: the dashboard is edited constantly and a cached app.css
    // would look exactly like a stylesheet that did not work.
    res.setHeader("Cache-Control", "no-store");
    fs.createReadStream(file).pipe(res);
  };

  return {
    name: "darwin-arena",

    configureServer(server) {
      server.middlewares.use("/arena", (req, res, next) => {
        // Strip the query string before touching the filesystem — `?demo=1` and
        // `?population=0x…` are the dashboard's two documented entry points.
        const rel = decodeURIComponent((req.url ?? "/").split("?")[0]);
        let file = path.join(WEB, rel);

        // Contain the handler to web/. Without this, /arena/../../.env is readable.
        if (!path.resolve(file).startsWith(WEB)) {
          res.statusCode = 403;
          return res.end("forbidden");
        }

        try {
          if (fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
        } catch {
          return next();
        }
        if (!fs.existsSync(file)) return next();
        return send(res, file);
      });
    },

    // /arena with no trailing slash would otherwise resolve relative asset paths
    // ("app.css", "js/main.js") against / and 404 every one of them.
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === "/arena") {
          res.statusCode = 301;
          res.setHeader("Location", "/arena/");
          return res.end();
        }
        return next();
      });
    },

    closeBundle() {
      const out = path.resolve(HERE, "dist/arena");
      fs.rmSync(out, { recursive: true, force: true });
      fs.cpSync(WEB, out, {
        recursive: true,
        filter: (src) => !/[\\/](node_modules|test)$/.test(src),
      });
      // eslint-disable-next-line no-console
      console.log("  dist/arena/  <- web/ (copied verbatim, not bundled)");

      // The manifest, if a deploy has produced one. Not an error when it has not:
      // before Season 0 both surfaces are meant to fall through to "undeployed".
      if (fs.existsSync(DEPLOYMENTS)) {
        const to = path.resolve(HERE, "dist/contracts/deployments");
        fs.rmSync(to, { recursive: true, force: true });
        fs.mkdirSync(to, { recursive: true });
        fs.cpSync(DEPLOYMENTS, to, { recursive: true });
        // eslint-disable-next-line no-console
        console.log("  dist/contracts/deployments/  <- contracts/deployments/");
      }
    },
  };
}

/**
 *  Serves `contracts/deployments/` at /contracts/deployments/.
 *
 *  Both surfaces need it and neither can reach it otherwise. `web/config.js` writes the
 *  path as `../contracts/deployments/50312.json` — relative to a page in `web/`, which
 *  resolves to exactly this URL once the dashboard is mounted at /arena/. So one
 *  middleware makes the arena's existing fetch work under the dev server AND gives the
 *  React app an absolute path to the same bytes. Read-only, and scoped to one directory.
 *
 *  It is a separate plugin from arena() because it is not part of `web/` — mixing them
 *  would put a path outside the copied tree behind a guard that exists to contain it.
 */
function deployments() {
  return {
    name: "darwin-deployments",
    configureServer(server) {
      server.middlewares.use("/contracts/deployments", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "/").split("?")[0]);
        const file = path.join(DEPLOYMENTS, rel);
        if (!path.resolve(file).startsWith(DEPLOYMENTS)) {
          res.statusCode = 403;
          return res.end("forbidden");
        }
        // A missing manifest is the normal state before Season 0, and this hands off with
        // next() rather than answering. That does NOT produce a 404 under the dev server:
        // Vite's SPA html-fallback answers 200 with index.html. So the resolver's
        // `if (!res.ok) return null` never fires here — what saves it is the catch around
        // `res.json()`, which throws on `<!doctype html>` (`web/js/chain.js:109-118`). Both
        // routes end at "not deployed yet", so the behaviour is right; the status code just
        // isn't the one you would guess. Don't go hunting for a 404 in dev — there isn't
        // one, and `!res.ok` is there for the real 404 a standalone host returns.
        if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return next();
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        return fs.createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), arena(), deployments()],

  server: {
    port: 3000,
    // The judge is told to open localhost:3000. Silently landing on 3001 because
    // something else held the port is worse than refusing to start.
    strictPort: true,
    // tokens.css and fonts.css live in ../web and are imported from src/. Without
    // this, Vite's dev server refuses to read them.
    fs: { allow: [path.resolve(HERE, ".."), HERE] },
  },

  preview: { port: 3000, strictPort: true },

  build: {
    outDir: "dist",
    // The vendored woff2 files are already the smallest they will get; inlining
    // them as base64 would grow them ~33% and block first paint.
    assetsInlineLimit: 0,
    sourcemap: true,
  },
});
