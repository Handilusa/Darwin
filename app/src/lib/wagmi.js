/**
 *  Chain and wallet wiring. One file, so there is one place a network is named.
 *
 *  ── WHY THE TRANSPORT IS PINNED ─────────────────────────────────────────────
 *  viem 2.56 ships a `somniaTestnet` chain object, and its default RPC is
 *  `https://api.infra.testnet.somnia.network` — NOT the endpoint this project runs on.
 *  Accepting the default would point the wallet at one node while `web/config.js`,
 *  `scripts/` and the dashboard all read another, and the first symptom would be an
 *  entry that "succeeded" against a chain state nobody else can see. So the RPC comes
 *  from `web/config.js` (`DEFAULT_RPC`) and the two surfaces are guaranteed to agree.
 *
 *  ── WHY config.js IS IMPORTED RATHER THAN COPIED ────────────────────────────
 *  `web/config.js` is plain ESM and guards every DOM access behind `globalThis`, so Vite
 *  can import it directly. The chain id, the RPC, the explorer and the deployment
 *  manifest path therefore have exactly one definition across both surfaces. Change the
 *  RPC there and the landing, the entry flow and the arena all move together.
 */

import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { defineChain } from "viem";

import { CHAIN_ID, DEFAULT_RPC, EXPLORER } from "../../../web/config.js";

/**
 *  Shannon, defined here rather than imported from viem/chains.
 *
 *  Not stubbornness: the chain object is four facts, and writing them out means the RPC
 *  cannot silently become someone else's node in a minor viem bump. `defineChain` gives
 *  the same object shape wagmi expects.
 */
export const shannon = defineChain({
  id: CHAIN_ID,
  name: "Somnia Shannon",
  nativeCurrency: { name: "Somnia Test Token", symbol: "STT", decimals: 18 },
  rpcUrls: {
    default: { http: [DEFAULT_RPC] },
    public: { http: [DEFAULT_RPC] },
  },
  blockExplorers: {
    default: { name: "Shannon Explorer", url: EXPLORER },
  },
  testnet: true,
});

/**
 *  Reown (WalletConnect) project id.
 *
 *  This ships in the client bundle by design — it identifies the dapp to the relay and is
 *  not a credential. Every WalletConnect dapp exposes its own; there is nothing to leak.
 *  Without it, RainbowKit still renders, but every QR-code wallet silently fails to pair,
 *  which is exactly the failure a judge on a phone would hit.
 */
export const WALLETCONNECT_PROJECT_ID = "006c638cc6ec95a3982952a1ee86aa05";

const APP_NAME = "DARWIN";

/**
 *  Wallet list, ordered by what a judge at this hackathon is most likely to be holding.
 *
 *  `injectedWallet` is last and deliberately present: it is the only entry that works for
 *  a browser wallet nobody here has heard of, and the whole point of the arena being
 *  permissionless is that entry does not depend on which five wallets we guessed.
 */
const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets: [metaMaskWallet, rainbowWallet, walletConnectWallet],
    },
    {
      groupName: "More",
      wallets: [coinbaseWallet, injectedWallet],
    },
  ],
  { appName: APP_NAME, projectId: WALLETCONNECT_PROJECT_ID },
);

export const wagmiConfig = createConfig({
  chains: [shannon],
  connectors,
  transports: {
    // `batch` collapses the entry form's six reads (two floors, cognition, allowance,
    // balance, decimals) into one HTTP round trip. On a public testnet RPC that is the
    // difference between a form that fills in instantly and one that visibly stutters.
    [shannon.id]: http(DEFAULT_RPC, { batch: true }),
  },
  ssr: false,
});

export { CHAIN_ID, DEFAULT_RPC, EXPLORER };
