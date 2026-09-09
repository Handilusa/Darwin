/**
 *  Entry point for `/enter/`.
 *
 *  The provider stack is `main.jsx`'s, deliberately identical and for the identical reasons —
 *  wagmi outermost because RainbowKit reads its config, TanStack Query between them because
 *  every hook the form uses (`useReadContracts`, `useSimulateContract`,
 *  `useWaitForTransactionReceipt`) is a query underneath and throws without a client. The
 *  duplication is eleven lines and the alternative was a shared `providers.jsx` that both
 *  entries import, which is the same eleven lines plus a file. If you change one, change the
 *  other; there is no test that would catch a drift.
 *
 *  The query client is module-scope here too, so a re-render cannot hand the tree a fresh
 *  client and drop the receipt watcher for a transaction the visitor has already signed —
 *  which on THIS page is the only page state that cannot be recovered by reloading.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";

import "@rainbow-me/rainbowkit/styles.css";
import "./styles.css";

import Console from "./Console.jsx";
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
          <Console />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
