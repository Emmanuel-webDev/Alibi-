// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title AssetTransferLib
/// @notice One convention for every asset path in Alibi:
///         `address(0)` = native QIE, anything else = an ERC-20 (e.g. QUSDC).
///         Native value is validated with strict equality, and a non-zero `msg.value`
///         is rejected on the ERC-20 path, so ETH can never be trapped by a mixed call.
/// @dev `pull` reads `msg.value`. Call it AT MOST ONCE per external entry point.
library AssetTransferLib {
    using SafeERC20 for IERC20;

    error NativeValueMismatch(uint256 sent, uint256 expected);
    error UnexpectedNativeValue(uint256 sent);
    error NativeTransferFailed();

    /// @dev Gas stipend for best-effort native pushes (see `tryPush`). Enough for a
    ///      multisig/proxy wallet's receive hook, small enough to bound griefing.
    uint256 internal constant TRY_PUSH_GAS = 100_000;

    /// @notice Collect `amount` of `asset` into this contract.
    function pull(address asset, address from, uint256 amount) internal {
        if (asset == address(0)) {
            if (msg.value != amount) revert NativeValueMismatch(msg.value, amount);
        } else {
            if (msg.value != 0) revert UnexpectedNativeValue(msg.value);
            if (amount != 0) IERC20(asset).safeTransferFrom(from, address(this), amount);
        }
    }

    /// @notice Send `amount` of `asset` to `to`; reverts on failure.
    function push(address asset, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (asset == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            IERC20(asset).safeTransfer(to, amount);
        }
    }

    /// @notice Best-effort send. Returns false instead of reverting, so one hostile or
    ///         broken recipient can never block a payout to somebody else.
    function tryPush(address asset, address to, uint256 amount) internal returns (bool) {
        if (amount == 0) return true;
        if (asset == address(0)) {
            (bool ok,) = to.call{value: amount, gas: TRY_PUSH_GAS}("");
            return ok;
        }
        (bool success, bytes memory ret) = asset.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        return success && (ret.length == 0 || abi.decode(ret, (bool)));
    }
}
