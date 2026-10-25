// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IAlibiRegistry
/// @notice The surface that the escrow, router, guard and vault depend on.
interface IAlibiRegistry {
    /// @dev Unverified: no valid KYC attestation (100% bond).
    ///      New: verified, no earned history (only stake can back credit).
    ///      Base / Proven: earned reputation unlocks capped unsecured credit.
    enum Tier {
        Unverified,
        New,
        Base,
        Proven
    }

    struct DebtClaim {
        uint256 agreementId;
        address creditor;
        uint256 remaining;
        uint64 createdAt;
    }

    // ---- reads ----
    function identityOf(address wallet) external view returns (bytes32);
    function hasActiveDebt(bytes32 identityId) external view returns (bool);
    function walletHasActiveDebt(address wallet) external view returns (bool);
    function isVerified(bytes32 identityId) external view returns (bool);
    function tierOf(bytes32 identityId) external view returns (Tier);
    function quoteBond(bytes32 identityId, address asset, uint256 total)
        external
        view
        returns (uint256 bond, Tier tier);

    // ---- escrow-only writes ----
    function reserveExposure(bytes32 identityId, address asset, uint256 amount) external;
    function releaseExposure(bytes32 identityId, address asset, uint256 amount) external;
    function recordSettlement(bytes32 payerId, bytes32 creditorId, address asset, uint256 total) external;
    function slashStake(bytes32 identityId, address asset, uint256 maxAmount) external returns (uint256 seized);
    function recordDefault(bytes32 identityId, uint256 agreementId, address creditor, address asset, uint256 debt)
        external;

    // ---- router-only write ----
    function consumeDebt(bytes32 identityId, address asset, uint256 available, uint256 maxClaims)
        external
        returns (
            address[] memory creditors,
            uint256[] memory amounts,
            uint256[] memory agreementIds,
            uint256 total
        );
}
