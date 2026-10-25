// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AssetTransferLib} from "./libraries/AssetTransferLib.sol";

/// @title PayoutAccounting
/// @notice "Push, and if the push fails, credit": a creditor whose address rejects funds
///         (reverting contract, out-of-gas hook, blocklisted token) can never block a
///         garnishment, a settlement, or anyone else's payout. They withdraw later instead.
abstract contract PayoutAccounting is ReentrancyGuard {
    /// @notice recipient => asset => amount waiting to be withdrawn
    mapping(address => mapping(address => uint256)) public claimable;

    event PayoutCredited(address indexed to, address indexed asset, uint256 amount);
    event ClaimableWithdrawn(address indexed to, address indexed asset, uint256 amount);

    error NothingToWithdraw();

    function _payout(address asset, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (!AssetTransferLib.tryPush(asset, to, amount)) {
            claimable[to][asset] += amount;
            emit PayoutCredited(to, asset, amount);
        }
    }

    function withdrawClaimable(address asset) external nonReentrant {
        uint256 amount = claimable[msg.sender][asset];
        if (amount == 0) revert NothingToWithdraw();
        claimable[msg.sender][asset] = 0;
        AssetTransferLib.push(asset, msg.sender, amount);
        emit ClaimableWithdrawn(msg.sender, asset, amount);
    }
}
