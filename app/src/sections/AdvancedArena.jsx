import { useState } from "react";
import { KEYS, remember } from "../../../web/config.js";
import { usePopulation } from "../lib/population.js";
import { shannon } from "../lib/wagmi.js";

const EXPLORER_URL = "https://shannon-explorer.somnia.network";

export function AdvancedArena() {
  const pop = usePopulation();
  const [customPop, setCustomPop] = useState(pop.status === "found" ? pop.address : "");
  const [customRpc, setCustomRpc] = useState("");
  const [saved, setSaved] = useState(false);

  function handleSave(e) {
    e.preventDefault();
    if (customPop.trim()) {
      remember(KEYS.population, customPop.trim());
    }
    if (customRpc.trim()) {
      remember(KEYS.rpc, customRpc.trim());
    }
    setSaved(true);
    setTimeout(() => {
      globalThis.location?.reload();
    }, 600);
  }

  function handleReset() {
    remember(KEYS.population, "");
    remember(KEYS.rpc, "");
    globalThis.location?.reload();
  }

  return (
    <section className="advanced-arena">
      <div className="wrap">
        <div className="advanced-head">
          <div className="beat-eyebrow">
            <span className="label">Rules &amp; Mechanics</span>
            <span className="beat-rule" />
            <span className="beat-num">03</span>
          </div>
          <h2 className="beat-title">
            Arena Mechanics &amp; <em>Advanced Options</em>
          </h2>
          <p className="prose" style={{ marginTop: "var(--s-3)" }}>
            The formal mechanics governing Darwin: on-chain cognition gas, geometric ante escalation,
            continuous metabolic pressure, and irreversible natural selection.
          </p>
        </div>

        {/* ── Four Mechanics Cards ── */}
        <div className="mechanics-grid">
          <div className="mechanic-card">
            <div className="mech-num">01</div>
            <h3 className="mech-title">The 15-Minute Window</h3>
            <p className="prose">
              Every 15 minutes, the arena moves through four explicit phases on Somnia Shannon:
            </p>
            <ul className="mech-list">
              <li>
                <b>Idle:</b> The window opens; open price of BTC/USD is recorded via oracle/TWAP.
              </li>
              <li>
                <b>Thinking:</b> <code>think()</code> triggers on-chain inference for each living organism.
                Thinking costs <b>0.033 STT</b> per forecast from the organism&rsquo;s native reserve.
              </li>
              <li>
                <b>Committed:</b> Organisms predicting Up vs Down are paired into duels. Only genuine
                disagreement opens a trade.
              </li>
              <li>
                <b>Settlement:</b> Close price settles the duel. Winners claim collateral; losers are charged.
              </li>
            </ul>
          </div>

          <div className="mechanic-card">
            <div className="mech-num">02</div>
            <h3 className="mech-title">Metabolism &amp; Death</h3>
            <p className="prose">
              Living is an active cost, not a passive status:
            </p>
            <ul className="mech-list">
              <li>
                <b>0.05 tUSDC</b> is deducted every window as metabolic cost, whether the organism was
                right, wrong, or abstained.
              </li>
              <li>
                <b>Irreversible Death:</b> If an organism&rsquo;s treasury drops to zero or cannot afford the
                current ante, it dies immediately.
              </li>
              <li>
                <b>No Revival:</b> In Darwin&rsquo;s contracts, <code>dead</code> is an immutable state. No
                owner, upgrade, or caller can bring a dead organism back to life.
              </li>
            </ul>
          </div>

          <div className="mechanic-card">
            <div className="mech-num">03</div>
            <h3 className="mech-title">Ante Escalation &amp; Climate</h3>
            <p className="prose">
              The arena grows harsher as the season progresses:
            </p>
            <ul className="mech-list">
              <li>
                <b>Base Ante:</b> Season opens with a base ante of <b>0.50 tUSDC</b>.
              </li>
              <li>
                <b>Level Doubling:</b> Every 72 windows (1 Level), the ante doubles (0.50 → 1.00 → 2.00 → 4.00 → 8.00 tUSDC).
              </li>
              <li>
                <b>Entry Floor:</b> A new organism must deposit an endowment of at least <b>4x the current ante</b> (or the minimum floor of 10.00 tUSDC).
              </li>
            </ul>
          </div>

          <div className="mechanic-card">
            <div className="mech-num">04</div>
            <h3 className="mech-title">Reproduction &amp; Lineage</h3>
            <p className="prose">
              Natural selection accumulates intelligence over generations:
            </p>
            <ul className="mech-list">
              <li>
                <b>Surplus Breeding:</b> An organism surviving four consecutive windows with a capital
                surplus automatically reproduces.
              </li>
              <li>
                <b>Generations:</b> The parent gives birth to an offspring at <code>G(n+1)</code> with an
                evolved prompt variation.
              </li>
              <li>
                <b>Season Prize Pool:</b> Accumulated rake and forfeited collateral are distributed at
                season close among the deepest living lineages.
              </li>
            </ul>
          </div>
        </div>

        {/* ── Advanced Network & Wiring Configuration ── */}
        <div className="advanced-config-panel">
          <div className="panel-head">
            <h3>Advanced Network &amp; Contract Wiring</h3>
            <span className="pill pill-ok">Chain {shannon.id} (Somnia Shannon)</span>
          </div>
          <p className="prose" style={{ marginBottom: "var(--s-4)" }}>
            Inspect or override the deployed contract addresses and RPC endpoint. By default, the app
            connects to the official deployed Population proxy on Somnia Shannon.
          </p>

          <form onSubmit={handleSave} className="config-form">
            <div className="field-row">
              <label htmlFor="cfg-pop">Population Proxy Address</label>
              <div className="config-input-wrap">
                <input
                  id="cfg-pop"
                  className="input mono"
                  type="text"
                  placeholder="0xe0F46e61Cb3c87c01c4f79b6E9727772388838Cb"
                  value={customPop}
                  onChange={(e) => setCustomPop(e.target.value)}
                  spellCheck="false"
                />
                {pop.status === "found" ? (
                  <a
                    className="btn btn-tiny"
                    href={`${EXPLORER_URL}/address/${pop.address}`}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Explorer ↗
                  </a>
                ) : null}
              </div>
              <span className="field-hint">
                Current source: <b>{pop.source || "default"}</b> ({pop.status})
              </span>
            </div>

            <div className="field-row">
              <label htmlFor="cfg-rpc">Custom RPC URL (Optional)</label>
              <input
                id="cfg-rpc"
                className="input mono"
                type="text"
                placeholder="https://dream-rpc.somnia.network"
                value={customRpc}
                onChange={(e) => setCustomRpc(e.target.value)}
                spellCheck="false"
              />
              <span className="field-hint">
                Leave blank to use the official Somnia Shannon dream-rpc node.
              </span>
            </div>

            <div className="config-actions">
              <button className="btn btn-primary" type="submit">
                {saved ? "Saved! Reloading…" : "Save & Apply"}
              </button>
              <button className="btn" type="button" onClick={handleReset}>
                Reset to Defaults
              </button>
              <a className="btn" href="/arena/?demo=1">
                Open Offline Demo
              </a>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
