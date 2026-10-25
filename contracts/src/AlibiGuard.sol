// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAlibiRegistry} from "./interfaces/IAlibiRegistry.sol";

/// @title AlibiGuard
/// @notice Drop-in for any QIE protocol: block wallets whose identity has an open default, and
///         give each verified identity (not each wallet) a single claim on incentives.
///
///     contract MyPool is AlibiGuard {
///         constructor(IAlibiRegistry r) AlibiGuard(r) {}
///         function borrow(uint256 a) external onlySolventQIE(msg.sender) { ... }
///     }
abstract contract AlibiGuard {
    IAlibiRegistry public immutable alibiRegistry;

    error AlibiActiveDefault(address user, bytes32 identityId);
    error AlibiNotVerified(address user);

    constructor(IAlibiRegistry registry_) {
        alibiRegistry = registry_;
    }

    /// @dev Reverts if the user's identity has an unpaid default. Unlinked wallets pass (no identity, no debt).
    modifier onlySolventQIE(address user) {
        _requireSolvent(user);
        _;
    }

    /// @dev Reverts unless the wallet is linked to a currently verified identity (use for one-per-person perks).
    modifier onlyVerifiedSolventQIE(address user) {
        bytes32 id = alibiRegistry.identityOf(user);
        if (!alibiRegistry.isVerified(id)) revert AlibiNotVerified(user);
        _requireSolvent(user);
        _;
    }

    function _requireSolvent(address user) internal view {
        if (alibiRegistry.walletHasActiveDebt(user)) {
            revert AlibiActiveDefault(user, alibiRegistry.identityOf(user));
        }
    }

    function _isSolvent(address user) internal view returns (bool) {
        return !alibiRegistry.walletHasActiveDebt(user);
    }
}
