import { useState, useMemo, useEffect } from "react";
import { formatEther, formatUnits, parseUnits } from "viem";
import {
  useAccount,
  useBalance,
  useChainId,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";

import { shannon } from "../lib/wagmi.js";
import { usePopulation } from "../lib/population.js";
import { collateralAbi, populationAbi, populationReadAbi, prophetAbi } from "../lib/abi.js";
import { THESIS } from "../../../web/js/labels.js";
import { IconRocket } from "../icons.jsx";

const EXPLORER_URL = "https://shannon-explorer.somnia.network";
const FAUCET_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours per wallet
const FAUCET_AMOUNT_STR = "10";

function formatCooldown(ms) {
  if (ms <= 0) return "0m";
  const totalSecs = Math.floor(ms / 1000);
  const hours = Math.floor(totalSecs / 3600);
  const minutes = Math.floor((totalSecs % 3600) / 60);
  const seconds = totalSecs % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function WalletDashboard({ onGoToLaunch }) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const pop = usePopulation();
  const population = pop.status === "found" ? pop.address : undefined;
  const isCorrectChain = chainId === shannon.id;

  const [copied, setCopied] = useState(false);

  function copyAddress() {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // 1. Native balance (STT)
  const native = useBalance({
    address,
    chainId: shannon.id,
    query: { enabled: Boolean(address) },
  });

  // 2. Read Population contract specs
  const arenaReads = useReadContracts({
    allowFailure: true,
    contracts: population
      ? [
          { address: population, abi: populationReadAbi, functionName: "collateral" },
          { address: population, abi: populationReadAbi, functionName: "livingCount" },
          { address: population, abi: populationReadAbi, functionName: "snapshot" },
        ]
      : [],
    query: { enabled: Boolean(population), refetchInterval: 12_000 },
  });

  const collateralAddress = arenaReads.data?.[0]?.result;
  const snapshotRaw = arenaReads.data?.[2]?.result;

  // 3. Read token data (tUSDC)
  const tokenReads = useReadContracts({
    allowFailure: true,
    contracts:
      collateralAddress && address && population
        ? [
            { address: collateralAddress, abi: collateralAbi, functionName: "decimals" },
            { address: collateralAddress, abi: collateralAbi, functionName: "symbol" },
            { address: collateralAddress, abi: collateralAbi, functionName: "balanceOf", args: [address] },
            { address: collateralAddress, abi: collateralAbi, functionName: "allowance", args: [address, population] },
          ]
        : [],
    query: { enabled: Boolean(collateralAddress && address && population), refetchInterval: 12_000 },
  });

  const decimals = tokenReads.data?.[0]?.result ?? 6;
  const symbol = tokenReads.data?.[1]?.result ?? "tUSDC";
  const balance = tokenReads.data?.[2]?.result;
  const allowance = tokenReads.data?.[3]?.result;

  // 4. Read all organisms from snapshot to filter user's organisms
  const allOrganisms = useMemo(() => {
    if (!Array.isArray(snapshotRaw)) return [];
    return snapshotRaw.map((o) => ({
      id: Number(o.id),
      addr: o.addr,
      parentId: Number(o.parentId),
      generation: Number(o.generation),
      treasury: o.treasury,
      streak: Number(o.streak),
      windowsLived: Number(o.windowsLived),
      correctCount: Number(o.correctCount),
      wrongCount: Number(o.wrongCount),
      abstainCount: Number(o.abstainCount),
      birthWindow: Number(o.birthWindow),
      deathWindow: Number(o.deathWindow),
      dead: Boolean(o.dead),
      belief: Number(o.belief),
      thesis: Number(o.thesis),
    }));
  }, [snapshotRaw]);

  // Batch read entrants and prompts for all organisms in snapshot
  const entrantCalls = useMemo(() => {
    if (!allOrganisms.length) return [];
    return allOrganisms.flatMap((o) => [
      { address: o.addr, abi: prophetAbi, functionName: "entrant" },
      { address: o.addr, abi: prophetAbi, functionName: "systemPrompt" },
    ]);
  }, [allOrganisms]);

  const detailsReads = useReadContracts({
    allowFailure: true,
    contracts: entrantCalls,
    query: { enabled: entrantCalls.length > 0, refetchInterval: 20_000 },
  });

  const myOrganisms = useMemo(() => {
    if (!address || !allOrganisms.length || !detailsReads.data) return [];
    const userAddr = address.toLowerCase();
    const result = [];

    allOrganisms.forEach((org, idx) => {
      const entrant = detailsReads.data[idx * 2]?.result;
      const prompt = detailsReads.data[idx * 2 + 1]?.result || "";
      if (entrant && String(entrant).toLowerCase() === userAddr) {
        result.push({
          ...org,
          entrant: String(entrant),
          systemPrompt: String(prompt),
        });
      }
    });

    return result.sort((a, b) => b.id - a.id);
  }, [address, allOrganisms, detailsReads.data]);

  // Capital in live organisms
  const capitalInLiving = useMemo(() => {
    return myOrganisms
      .filter((o) => !o.dead && typeof o.treasury === "bigint")
      .reduce((acc, o) => acc + o.treasury, 0n);
  }, [myOrganisms]);

  const livingCount = myOrganisms.filter((o) => !o.dead).length;

  // 5. Direct Faucet transaction & 24h cooldown per wallet
  const [lastClaim, setLastClaim] = useState(() => {
    if (typeof window === "undefined" || !address) return 0;
    try {
      const val = localStorage.getItem(`darwin.faucet.claim.${address.toLowerCase()}`);
      return val ? parseInt(val, 10) || 0 : 0;
    } catch {
      return 0;
    }
  });

  const [now, setNow] = useState(() => Date.now());

  // Reload last claim whenever connected wallet address changes
  useEffect(() => {
    if (!address) {
      setLastClaim(0);
      return;
    }
    try {
      const val = localStorage.getItem(`darwin.faucet.claim.${address.toLowerCase()}`);
      setLastClaim(val ? parseInt(val, 10) || 0 : 0);
    } catch {
      setLastClaim(0);
    }
  }, [address]);

  // Sync across open browser tabs
  useEffect(() => {
    function onStorage(e) {
      if (address && e.key === `darwin.faucet.claim.${address.toLowerCase()}`) {
        const val = e.newValue ? parseInt(e.newValue, 10) || 0 : 0;
        setLastClaim(val);
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [address]);

  const timePassed = now - lastClaim;
  const isCooldown = Boolean(address && lastClaim > 0 && timePassed >= 0 && timePassed < FAUCET_COOLDOWN_MS);
  const remainingMs = isCooldown ? FAUCET_COOLDOWN_MS - timePassed : 0;

  // Live timer tick while cooldown is active
  useEffect(() => {
    if (!isCooldown) return;
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [isCooldown]);

  const faucetTx = useWriteContract();
  const faucetRcpt = useWaitForTransactionReceipt({ hash: faucetTx.data });

  const approveTx = useWriteContract();
  const approveRcpt = useWaitForTransactionReceipt({ hash: approveTx.data });

  useEffect(() => {
    if (approveRcpt.isSuccess) {
      tokenReads.refetch();
    }
  }, [approveRcpt.isSuccess, tokenReads]);

  useEffect(() => {
    if (faucetRcpt.isSuccess) {
      if (address) {
        const ts = Date.now();
        try {
          localStorage.setItem(`darwin.faucet.claim.${address.toLowerCase()}`, String(ts));
        } catch {}
        setLastClaim(ts);
        setNow(ts);
      }
      tokenReads.refetch();
    }
  }, [faucetRcpt.isSuccess, address, tokenReads]);

  function handleQuickMint() {
    if (!collateralAddress || isCooldown) return;
    faucetTx.writeContract({
      address: collateralAddress,
      abi: collateralAbi,
      functionName: "faucet",
      args: [parseUnits(FAUCET_AMOUNT_STR, decimals)],
    });
  }

  function handleQuickApprove() {
    if (!collateralAddress || !population) return;
    approveTx.writeContract({
      address: collateralAddress,
      abi: collateralAbi,
      functionName: "approve",
      args: [population, parseUnits("100", decimals)],
    });
  }

  const shortAddress = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";

  return (
    <section className="wallet-dashboard">
      <div className="wrap">
        <div className="dashboard-head">
          <div className="beat-eyebrow">
            <span className="label">Dashboard</span>
            <span className="beat-rule" />
            <span className="beat-num">01</span>
          </div>
          <h2 className="beat-title">
            Wallet Portfolio &amp; <em>Organisms</em>
          </h2>
          <p className="prose" style={{ marginTop: "var(--s-3)" }}>
            Inspect your native STT reserves for cognition gas, collateral balances in {symbol}, and
            track the health and performance of your on-chain trading organisms.
          </p>
        </div>

        {!isConnected ? (
          <div className="dashboard-connect-card">
            <div className="dash-connect-info">
              <h3>Connect Your Wallet</h3>
              <p className="prose">
                Connect your Ethereum wallet to check your balances, manage allowances, and inspect all
                organisms launched by your address into the Darwin arena.
              </p>
            </div>
            <ConnectButton showBalance={false} />
          </div>
        ) : (
          <>
            {/* ── Wallet Identity Bar ── */}
            <div className="wallet-bar">
              <div className="wallet-info">
                <span className="dot dot-live" />
                <span className="wallet-address" title={address}>
                  {shortAddress}
                </span>
                <button
                  className="btn btn-tiny"
                  type="button"
                  onClick={copyAddress}
                  title="Copy full address"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
                <a
                  className="btn btn-tiny"
                  href={`${EXPLORER_URL}/address/${address}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Explorer ↗
                </a>
              </div>
              <div className="wallet-network">
                <span className="pill pill-ok">
                  {isCorrectChain ? `Somnia Shannon · ${shannon.id}` : `Wrong Network (Chain ${chainId})`}
                </span>
              </div>
            </div>

            {/* ── Key Metrics Grid ── */}
            <div className="metrics-grid">
              {/* Card 1: STT */}
              <div className="metric-card">
                <span className="metric-label">Native Gas &amp; Cognition</span>
                <div className="metric-val is-heat">
                  {native.data?.value !== undefined
                    ? `${Number(formatEther(native.data.value)).toFixed(3)} STT`
                    : "…"}
                </div>
                <p className="metric-sub">
                  Attached to organisms at birth to pay for on-chain inference (0.033 STT per forecast).
                </p>
                <div className="metric-action">
                  <a
                    className="btn btn-tiny"
                    href="https://testnet.somnia.network/"
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Somnia Faucet ↗
                  </a>
                </div>
              </div>

              {/* Card 2: tUSDC */}
              <div className="metric-card">
                <span className="metric-label">Collateral Available</span>
                <div className="metric-val is-life">
                  {typeof balance === "bigint" ? `${formatUnits(balance, decimals)} ${symbol}` : "…"}
                </div>
                <p className="metric-sub">
                  Testnet capital available in your wallet to fund organism endowments and antes.
                </p>
                <div className="metric-action">
                  <button
                    className="btn btn-tiny btn-primary"
                    type="button"
                    onClick={handleQuickMint}
                    disabled={faucetTx.isPending || faucetRcpt.isLoading || isCooldown}
                    title={
                      isCooldown
                        ? `Cooldown active: limit 10 ${symbol} every 24h per wallet. Next claim available in ${formatCooldown(remainingMs)}.`
                        : `Claim 10 ${symbol} from faucet (limit: 10 per 24 hours per wallet).`
                    }
                  >
                    {faucetTx.isPending
                      ? "Confirm…"
                      : faucetRcpt.isLoading
                      ? "Minting…"
                      : isCooldown
                      ? `Cooldown (${formatCooldown(remainingMs)})`
                      : `+${FAUCET_AMOUNT_STR} Faucet`}
                  </button>
                  <span
                    className={`pill ${isCooldown ? "pill-warn" : ""}`}
                    style={{ fontSize: "10px", alignSelf: "center" }}
                    title="10 tUSDC every 24 hours per wallet"
                  >
                    {isCooldown ? "Limit 10/24h" : "10 / 24h"}
                  </span>
                </div>
              </div>

              {/* Card 3: Allowance */}
              <div className="metric-card">
                <span className="metric-label">Allowance to Darwin</span>
                <div className="metric-val">
                  {typeof allowance === "bigint" ? `${formatUnits(allowance, decimals)} ${symbol}` : "…"}
                </div>
                <p className="metric-sub">
                  {typeof allowance === "bigint" && allowance >= parseUnits("10", decimals) ? (
                    <span className="pill pill-ok">Approved for launch</span>
                  ) : (
                    <span className="pill pill-warn">Low allowance</span>
                  )}
                </p>
                <div className="metric-action">
                  <button
                    className="btn btn-tiny"
                    type="button"
                    onClick={handleQuickApprove}
                    disabled={approveTx.isPending || approveRcpt.isLoading}
                  >
                    {approveTx.isPending ? "Confirm…" : approveRcpt.isLoading ? "Approving…" : "Approve +100"}
                  </button>
                </div>
              </div>

              {/* Card 4: Capital at Risk */}
              <div className="metric-card">
                <span className="metric-label">Capital at Risk in Arena</span>
                <div className="metric-val is-life">
                  {formatUnits(capitalInLiving, decimals)} {symbol}
                </div>
                <p className="metric-sub">
                  Locked across <b>{livingCount} living</b> {livingCount === 1 ? "organism" : "organisms"} (
                  {myOrganisms.length} total ever born).
                </p>
                <div className="metric-action">
                  <button className="btn btn-tiny btn-primary" type="button" onClick={onGoToLaunch}>
                    + Launch New
                  </button>
                </div>
              </div>
            </div>

            {/* ── My Organisms Section ── */}
            <div className="my-organisms-section">
              <div className="section-head">
                <h3 className="section-title">
                  My Organisms in the Arena <span className="badge">{myOrganisms.length}</span>
                </h3>
                <div className="section-actions">
                  <button className="btn btn-tiny" type="button" onClick={onGoToLaunch}>
                    <IconRocket size={13} className="btn-icon" />
                    <span>Launch Another</span>
                  </button>
                  <a className="btn btn-tiny" href="/arena/">
                    Open Colosseum ↗
                  </a>
                </div>
              </div>

              {detailsReads.isLoading && myOrganisms.length === 0 ? (
                <div className="panel empty-box">
                  <p className="sub">Reading population contracts and finding your organisms…</p>
                </div>
              ) : myOrganisms.length === 0 ? (
                <div className="panel empty-box">
                  <h4>No organisms entered yet</h4>
                  <p className="prose" style={{ margin: "var(--s-3) auto", maxWidth: "480px" }}>
                    You have not deployed any forecasters to this arena. Write a trading thesis in
                    English, fund its collateral endowment, and watch it trade.
                  </p>
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={onGoToLaunch}
                    style={{ marginTop: "var(--s-3)" }}
                  >
                    <IconRocket size={16} className="btn-icon" />
                    <span>Enter the Population</span>
                  </button>
                </div>
              ) : (
                <div className="organisms-grid">
                  {myOrganisms.map((org) => {
                    const treasuryNum =
                      typeof org.treasury === "bigint"
                        ? Number(formatUnits(org.treasury, decimals))
                        : 0;
                    const windowsLeft = Math.floor(treasuryNum / 0.05);
                    const thesisName = THESIS[org.thesis] || "Custom";

                    return (
                      <div className={`organism-card ${org.dead ? "is-dead" : "is-alive"}`} key={org.id}>
                        <div className="org-card-head">
                          <div className="org-id-group">
                            <span className="org-id">#{org.id}</span>
                            <span className="org-thesis">{thesisName}</span>
                            <span className="org-gen">G{org.generation}</span>
                          </div>
                          <span className={`pill ${org.dead ? "pill-bad" : "pill-ok"}`}>
                            {org.dead ? "† DEAD" : "● ALIVE"}
                          </span>
                        </div>

                        <div className="org-vitals-row">
                          <div className="org-vital">
                            <span className="vital-label">Treasury</span>
                            <span className={`vital-value ${org.dead ? "is-ash" : "is-life"}`}>
                              {treasuryNum.toFixed(2)} {symbol}
                            </span>
                          </div>
                          <div className="org-vital">
                            <span className="vital-label">Metabolic Runway</span>
                            <span className="vital-value">
                              {org.dead ? "Spent" : `${windowsLeft} windows (~${Math.round(windowsLeft / 4)}h)`}
                            </span>
                          </div>
                          <div className="org-vital">
                            <span className="vital-label">Record (W · D · L)</span>
                            <span className="vital-value mono">
                              {org.correctCount} · {org.abstainCount} · {org.wrongCount}
                            </span>
                          </div>
                        </div>

                        {org.systemPrompt ? (
                          <div className="org-prompt-box">
                            <span className="prompt-label">Genome thesis</span>
                            <p className="prompt-quote">&ldquo;{org.systemPrompt}&rdquo;</p>
                          </div>
                        ) : null}

                        <div className="org-card-foot">
                          <span className="fig-cap">
                            Born window {org.birthWindow}
                            {org.dead ? ` · died w${org.deathWindow}` : ` · lived ${org.windowsLived}w`}
                          </span>
                          <a
                            className="btn btn-tiny"
                            href={`/arena/?selected=${org.id}`}
                            title="Inspect in Arena"
                          >
                            Arena ↗
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
