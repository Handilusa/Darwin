// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Like} from "./interfaces/IDreamDEX.sol";

/// @dev The two things this contract needs from the arena. Deliberately not
///      `Population` itself: importing the arena here would make the dependency
///      circular, and this file must stay readable on its own in an explorer.
interface IArenaBooks {
    function collateral() external view returns (address);
    function donatePrizePool(uint256 amount) external;
}

/**
 *  The house's own position, held where anyone can see it.
 *
 *  The eight genesis organisms are the protocol's seed position, not the operator's
 *  private stake, so their prize money is paid HERE rather than to the deployer's
 *  EOA. This contract has no owner, no withdrawal, no arbitrary call and no upgrade
 *  path: the only thing that can be done with the collateral it accumulates is push
 *  it back into the players' prize pool, and anyone may do it.
 *
 *  What that buys is checkable in four reads, and the fourth is not optional:
 *
 *    1. `Population.genesisTreasury()` is not the owner.
 *    2. This code — no owner, no withdraw, no arbitrary call, no `upgradeTo`.
 *    3. `recycle()` is the only state-changing function, and its destination is
 *       fixed at construction.
 *    4. `Population.sweep`'s collateral leg cannot reach `prizePool`.
 *
 *  Without (4), (1) through (3) are decorative: a reader who greps `onlyOwner` in
 *  the arena would find a path from the players' pot to the operator anyway.
 *
 *  Deliberately has no `receive()`. Nothing in `Population` sends native to an
 *  `entrant` — the only native transfers are `retire` (to `msg.sender`, and a
 *  founder can never be retired) and `sweep` (owner-directed) — so refusing native
 *  costs nothing and removes a balance with no outlet.
 *
 *  `collateral` is READ FROM THE ARENA at call time rather than stored as an
 *  immutable, so a `setWiring` repoint cannot strand this contract holding a token
 *  it has no code path for.
 */
contract GenesisTreasury {
    /// @dev Immutable, and the reason there is no setter anywhere in this file: the
    ///      destination of every token that arrives here is fixed at construction.
    address public immutable arena;

    /// @dev So a frontend reads a number instead of replaying `Recycled` logs. The
    ///      one concession to convenience in this file, and one `SSTORE`.
    uint256 public totalRecycled;

    event Recycled(address indexed caller, uint256 amount);

    error ZeroArena();
    error NothingToRecycle();
    error ApprovalFailed();

    constructor(address arena_) {
        if (arena_ == address(0)) revert ZeroArena();
        arena = arena_;
    }

    /// @dev Convenience mirror of the arena's own wiring, so a reader checking this
    ///      contract does not have to go and read the arena to know what it holds.
    function collateral() external view returns (address) {
        return IArenaBooks(arena).collateral();
    }

    /**
     *  Push everything this contract holds into the players' prize pool.
     *
     *  Permissionless by design. There is no privileged caller because there is no
     *  privileged destination: `donatePrizePool` is the only outlet, it only ever
     *  increments `prizePool`, and `prizePool` pays the top three living organisms.
     *  Gating this on an owner would add an address that can WITHHOLD without
     *  adding one that can DIVERT — strictly worse for the property this contract
     *  exists to make checkable.
     */
    function recycle() external returns (uint256 amount) {
        address token = IArenaBooks(arena).collateral();
        amount = IERC20Like(token).balanceOf(address(this));
        if (amount == 0) revert NothingToRecycle();
        if (!IERC20Like(token).approve(arena, amount)) revert ApprovalFailed();
        IArenaBooks(arena).donatePrizePool(amount);
        totalRecycled += amount;
        emit Recycled(msg.sender, amount);
    }
}
