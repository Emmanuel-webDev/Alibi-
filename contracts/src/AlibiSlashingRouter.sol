// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAlibiRegistry} from "./interfaces/IAlibiRegistry.sol";
import {AssetTransferLib} from "./libraries/AssetTransferLib.sol";
import {PayoutAccounting} from "./PayoutAccounting.sol";

/// @title AlibiSlashingRouter
/// @notice The settlement rail. Money paid to a wallet THROUGH this contract first satisfies any
///         open debt on the wallet's identity (oldest claim first), then the rest goes through.
///
/// Scope, stated honestly: this is a commercial settlement rail and a DeFi choke point, not an L1
/// feature. A plain transfer straight to a wallet bypasses it. Alibi invoices, milestone releases and
/// protocols that integrate the router/AlibiGuard are covered; the incentive to use it is that
/// counterparties who require verified, solvent partners only pay through it.
contract AlibiSlashingRouter is PayoutAccounting {
    IAlibiRegistry public immutable registry;
    /// @notice Gas bound on the waterfall: at most this many claims are paid per routed payment.
    uint256 public immutable maxClaimsPerPayment;

    event PaymentRouted(
        address indexed payer,
        address indexed recipient,
        bytes32 indexed identityId,
        address asset,
        uint256 gross,
        uint256 garnished,
        uint256 net
    );
    /// @notice One event per claim paid out of a garnishment.
    event CrossWalletGarnishmentExecuted(
        bytes32 indexed identityId,
        address indexed recipientWallet,
        address indexed creditor,
        address asset,
        uint256 agreementId,
        uint256 amount
    );

    error ZeroAddress();
    error ZeroAmount();
    error InvalidMaxClaims();

    constructor(IAlibiRegistry registry_, uint256 maxClaimsPerPayment_) {
        if (address(registry_) == address(0)) revert ZeroAddress();
        if (maxClaimsPerPayment_ == 0 || maxClaimsPerPayment_ > 50) revert InvalidMaxClaims();
        registry = registry_;
        maxClaimsPerPayment = maxClaimsPerPayment_;
    }

    /// @notice Pay `amount` of `asset` to `recipient`, garnishing any debt on the recipient's identity.
    /// @dev Native: send exactly `amount` as msg.value. ERC-20: approve the router first.
    /// @return garnished how much was diverted to creditors
    function routePayment(address recipient, address asset, uint256 amount)
        external
        payable
        nonReentrant
        returns (uint256 garnished)
    {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        AssetTransferLib.pull(asset, msg.sender, amount);

        bytes32 id = registry.identityOf(recipient);
        if (id != bytes32(0) && registry.hasActiveDebt(id)) {
            // registry state is updated first (checks-effects-interactions)
            (address[] memory creditors, uint256[] memory amounts, uint256[] memory agreementIds, uint256 total) =
                registry.consumeDebt(id, asset, amount, maxClaimsPerPayment);
            garnished = total;
            for (uint256 k = 0; k < creditors.length; k++) {
                _payout(asset, creditors[k], amounts[k]);
                emit CrossWalletGarnishmentExecuted(id, recipient, creditors[k], asset, agreementIds[k], amounts[k]);
            }
        }

        uint256 net = amount - garnished;
        _payout(asset, recipient, net);
        emit PaymentRouted(msg.sender, recipient, id, asset, amount, garnished, net);
    }

    /// @notice Preview the split a payment would get right now (does not need an approval or value).
    function previewSplit(address recipient, address asset, uint256 amount)
        external
        view
        returns (uint256 garnished, uint256 net, uint256 claimsHit)
    {
        bytes32 id = registry.identityOf(recipient);
        if (id == bytes32(0)) return (0, amount, 0);
        IAlibiRegistryView r = IAlibiRegistryView(address(registry));
        IAlibiRegistry.DebtClaim[] memory open = r.getOpenClaims(id, asset);
        uint256 left = amount;
        for (uint256 k = 0; k < open.length && k < maxClaimsPerPayment && left > 0; k++) {
            uint256 take = open[k].remaining < left ? open[k].remaining : left;
            garnished += take;
            left -= take;
            claimsHit++;
        }
        net = amount - garnished;
    }
}

/// @dev View helper interface for the router preview (kept separate so IAlibiRegistry stays minimal).
interface IAlibiRegistryView {
    function getOpenClaims(bytes32 id, address asset) external view returns (IAlibiRegistry.DebtClaim[] memory);
}
