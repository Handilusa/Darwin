/**
 *  Hardhat — the JavaScript runtime for SDK-integrated work.
 *
 *  WHAT THIS IS AND IS NOT, stated plainly so nobody loses an hour to it.
 *
 *  Foundry is the only compiler and the only test runner in this repo. `contracts/` is a
 *  Foundry project: it resolves OpenZeppelin through `lib/` remappings, not node_modules,
 *  and duplicating that resolution here would create two compilers, two artifact
 *  directories, and one future afternoon spent finding out which of them produced the
 *  bytecode that is actually deployed. So `paths.sources` deliberately points at an empty
 *  directory: `npx hardhat compile` is a no-op, by design. Use `npm run build`.
 *
 *  What Hardhat is here for is the thing Foundry cannot do — run
 *  `@somnia-chain/markets-sdk` and `@somnia-chain/reactivity`, which are TypeScript
 *  packages with no Solidity-side equivalent:
 *
 *    npx hardhat console --network somnia     # poke the SDK interactively
 *    npx hardhat run scripts/<x>.ts --network somnia
 *
 *  The operational scripts (`cadence`, `fund`, `monitor`, `prove`) do NOT go through
 *  Hardhat. They run on viem + tsx so that keeping the population alive depends on two
 *  packages instead of a plugin graph. Nothing on the critical path imports this file.
 *
 *  CommonJS on purpose: package.json has no `"type": "module"`, so this is the format
 *  Hardhat 2 loads without a ts-node dependency. tsx runs ESM-syntax `.ts` regardless.
 */
require("dotenv").config();

const RPC = process.env.SOMNIA_RPC_URL || "https://dream-rpc.somnia.network";
const KEY = process.env.PRIVATE_KEY;

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  // Kept in sync with contracts/foundry.toml. Hardhat does not compile this project,
  // but a mismatched version here would be a lie in the config if it ever did.
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris",
    },
  },

  paths: {
    sources: "hardhat/contracts", // intentionally empty — see the header
    tests: "hardhat/test",
    cache: "hardhat/cache",
    artifacts: "hardhat/artifacts",
  },

  networks: {
    somnia: {
      url: RPC,
      chainId: 50312,
      accounts: KEY ? [KEY] : [],
    },
  },
};
