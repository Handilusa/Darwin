/**
 *  Wrapper that runs cadence.ts AND serves a health endpoint.
 *
 *  WHY: Render's free Web Service tier spins down after 15 min of no HTTP
 *  traffic. UptimeRobot pings this every 5 min → Render stays awake →
 *  cadence runs 24/7 for $0.
 *
 *  The cadence is spawned as a child process so this file touches NOTHING
 *  in cadence.ts — no imports, no modifications, no risk.
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";

const PORT = process.env.PORT || 10000;

// ── Start cadence as a child process ─────────────────────────────────────────
const child = spawn("npx", ["tsx", "scripts/cadence.ts"], {
  stdio: "inherit",
  env: process.env,
  shell: true,
});

child.on("exit", (code) => {
  console.error(`[health] cadence exited with code ${code} — restarting in 10s`);
  setTimeout(() => process.exit(1), 10_000); // let Render restart the whole container
});

// ── Minimal HTTP server for health checks ────────────────────────────────────
const started = Date.now();

createServer((req, res) => {
  const uptime = Math.floor((Date.now() - started) / 1000);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "alive", uptime_seconds: uptime }));
}).listen(PORT, () => {
  console.log(`[health] listening on :${PORT}`);
});
