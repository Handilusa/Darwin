/**
 *  A headless-chromium driver over CDP, shared by `landing.mjs` and `arena.mjs`.
 *
 *  Extracted from `landing.mjs` when the console got a harness of its own. Everything here was
 *  learned the hard way on this machine and none of it is incidental — that is the reason it is one
 *  file rather than two copies that drift.
 *
 *  ── WHY THE DEBUG PORT IS 0 AND NOT 9222 ────────────────────────────────────
 *  The first version hardcoded 9222 and hung for minutes with no output. On this machine 9222 is
 *  permanently held by `msedgewebview2.exe` — some other app's embedded browser — so the spawned
 *  chromium could not bind it and `/json/list` answered from a browser that had never heard of the
 *  page under test. Asking for port 0 and reading the port back out of `DevToolsActivePort` (which
 *  chrome writes into its own user-data-dir once it is actually listening) makes that class of
 *  collision impossible rather than unlikely. The profile directory is per-run for the same reason:
 *  a leftover chromium holding the lock would otherwise make every subsequent run fail in a way
 *  that looks like the page.
 *
 *  ── SAMPLE ON THE WALL CLOCK, NEVER `--virtual-time-budget` ─────────────────
 *  Chrome races the virtual clock while GSAP's ticker reads `performance.now()`, so a capture
 *  labelled 2200ms shows a timeline fifty REAL milliseconds in — an entire population at
 *  `opacity: 0`, indistinguishable from the bug the reveal defences exist to prevent. `CLAUDE.md`
 *  records the same trap. There is no virtual-time flag anywhere in this file and there must not be.
 *
 *  Every wait is bounded and every socket failure rejects. A verification harness that can hang is
 *  worse than no harness — it reports "still running" for a page that is broken.
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export { sleep };

export const CHROME =
  process.env.CHROME ??
  `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe`;

/**
 *  Launch chromium, attach to its page target, enable the four domains both harnesses read.
 *
 *  Returns null when there is no chromium to drive, having already printed a SKIP line — a machine
 *  without the browser must not fail the suite, and must not silently look like a pass either.
 */
export async function launch({ watchdogMs = 150_000, windowSize = "1440,900", note = console.log } = {}) {
  if (!existsSync(CHROME)) {
    note(`SKIP — no chromium at ${CHROME}. Set CHROME=<path to chrome.exe> to run this.`);
    return null;
  }

  const profile = join(tmpdir(), `darwin-cdp-${process.pid}`);
  let chrome = null;
  let ws = null;

  function cleanup() {
    try {
      ws?.close();
    } catch {}
    if (chrome?.pid) {
      // chrome.kill() on Windows reaps only the launcher; the renderer children keep the profile
      // locked, which is exactly what makes the *next* run fail mysteriously.
      try {
        if (process.platform === "win32") {
          spawn("taskkill", ["/pid", String(chrome.pid), "/T", "/F"], { stdio: "ignore" });
        } else {
          chrome.kill();
        }
      } catch {}
    }
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {}
  }

  /* A harness that hangs is a harness that lies. Nothing below can outlast this. */
  const watchdog = setTimeout(() => {
    note(`\nTIMEOUT — the driver exceeded ${Math.round(watchdogMs / 1000)}s. Last line above is where it stopped.`);
    cleanup();
    process.exit(2);
  }, watchdogMs);

  note(`chromium  ${CHROME}`);

  chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      "--remote-debugging-address=127.0.0.1",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      `--user-data-dir=${profile}`,
      `--window-size=${windowSize}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  chrome.on("error", (e) => {
    note(`FAIL — could not launch chromium: ${e.message}`);
    cleanup();
    process.exit(1);
  });
  chrome.on("exit", (code) => {
    if (code !== null && code !== 0) note(`  (chromium exited with ${code})`);
  });

  /** The port chrome actually bound, read from the file it writes when it starts listening. */
  const port = await (async () => {
    const f = join(profile, "DevToolsActivePort");
    for (let i = 0; i < 120; i++) {
      try {
        const [p] = readFileSync(f, "utf8").split("\n");
        if (p && Number(p) > 0) return Number(p);
      } catch {
        /* not written yet */
      }
      await sleep(250);
    }
    throw new Error("chrome never wrote DevToolsActivePort — it did not start listening");
  })();
  note(`devtools  127.0.0.1:${port}`);

  const wsUrl = await (async () => {
    for (let i = 0; i < 60; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
        const list = await res.json();
        const page = list.find((t) => t.type === "page");
        if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
      } catch {
        /* not up yet */
      }
      await sleep(250);
    }
    throw new Error(`chrome on ${port} never exposed a page target`);
  })();

  ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("websocket never opened")), 10_000);
    ws.onopen = () => {
      clearTimeout(t);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(t);
      reject(new Error("websocket errored before opening"));
    };
  });
  note("attached to page target");

  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method) {
      events.push(msg);
    }
  };
  ws.onclose = () => {
    for (const [, settle] of pending) settle({ error: { message: "socket closed mid-call" } });
    pending.clear();
  };

  function send(method, params = {}) {
    const n = ++id;
    ws.send(JSON.stringify({ id: n, method, params }));
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`${method}: no reply in 20s`)), 20_000);
      pending.set(n, (msg) => {
        clearTimeout(t);
        msg.error ? rej(new Error(`${method}: ${msg.error.message}`)) : res(msg.result);
      });
    });
  }

  async function evaluate(expression) {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval threw");
    return r.result.value;
  }

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Network.enable");

  return {
    send,
    evaluate,
    events,
    note,
    /** Drop everything seen so far — call between navigations so buckets are per-page. */
    forget: () => events.splice(0, events.length),
    close: () => {
      clearTimeout(watchdog);
      cleanup();
    },
  };
}

/**
 *  Classify what the browser complained about.
 *
 *  `Log.entryAdded` does NOT carry `console.error()` from page script, and `motion.js`'s missing-token
 *  guard reports drift as `console.warn` — so `Runtime.consoleAPICalled` has to be read too, and
 *  warnings are a bucket of their own rather than noise. That guard exists precisely because four
 *  token names silently resolved to a retired palette's fallbacks for an entire re-theme; a harness
 *  that ignored warnings would have watched it happen.
 */
export function classify(events) {
  const api = (type) =>
    events
      .filter((e) => e.method === "Runtime.consoleAPICalled" && e.params.type === type)
      .map((e) => e.params.args.map((a) => a.value ?? a.description ?? a.type).join(" "));

  return {
    logErrors: events
      .filter((e) => e.method === "Log.entryAdded" && e.params.entry.level === "error")
      .map((e) => e.params.entry.text),
    apiErrors: api("error"),
    warnings: api("warning"),
    exceptions: events
      .filter((e) => e.method === "Runtime.exceptionThrown")
      .map((e) => e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text),
    failedReqs: events
      .filter((e) => e.method === "Network.loadingFailed" && !e.params.errorText.includes("ERR_ABORTED"))
      .map((e) => e.params.errorText),
    /** Every URL the page asked for, so a harness can assert what it did NOT ask for. */
    requested: events
      .filter((e) => e.method === "Network.requestWillBeSent")
      .map((e) => e.params.request.url),
  };
}
