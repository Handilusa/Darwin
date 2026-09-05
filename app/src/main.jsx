/**
 *  Entry point.
 *
 *  Provider order is fixed by the libraries, not by preference: wagmi has to be outermost
 *  because RainbowKit reads its config; TanStack Query sits between them because every
 *  wagmi hook the entry form uses (`useReadContracts`, `useSimulateContract`,
 *  `useWaitForTransactionReceipt`) is a query under the hood and throws without a client.
 *
 *  ── WHY THE QUERY CLIENT IS MODULE-SCOPE ────────────────────────────────────
 *  Constructed here rather than inside the component, so a re-render can never hand the
 *  tree a fresh client and drop every in-flight read — including the receipt watcher for a
 *  transaction the visitor has already signed.
 *
 *  The defaults matter for a public testnet RPC: reads are quoted against a chain that
 *  moves, so `staleTime` is deliberately short, and `retry: 1` because a node that refuses
 *  an `eth_call` twice in a row is telling you something a third attempt will not change.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";

// RainbowKit's own stylesheet first, so `styles.css` — which restates its radii and
// colours through our tokens — wins on equal specificity.
import "@rainbow-me/rainbowkit/styles.css";
import "./styles.css";

import App from "./App.jsx";
import { wagmiConfig, shannon } from "./lib/wagmi.js";
import { darkFieldTheme, assertTokens } from "./lib/theme.js";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// Dev-only, compiled out of the build: shouts if theme.js's colour mirrors drift from
// tokens.css. See the comment at its declaration.
assertTokens();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkFieldTheme}
          initialChain={shannon}
          appInfo={{ appName: "DARWIN" }}
          modalSize="compact"
        >
          <App />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
