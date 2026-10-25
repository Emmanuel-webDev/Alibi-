// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IAlibiRegistry} from "./interfaces/IAlibiRegistry.sol";
import {AssetTransferLib} from "./libraries/AssetTransferLib.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {PayoutAccounting} from "./PayoutAccounting.sol";

/// @title AlibiCreditEscrow
/// @notice Post-paid commitments with a fractional upfront bond.
///
///   payer locks `bond` now, owes `total - bond` by `deadline`.
///   settle  -> creditor receives `total` (bond + remainder); payer pays a small protocol fee.
///   default -> creditor receives the bond (minus a 0.5% keeper bounty) plus any seized stake;
///              whatever is still unpaid becomes a claim in the payer identity's FIFO debt queue.
///
/// There are NO test backdoors: the Judge Sandbox simply uses a real agreement with a very short
/// duration (`minDuration` is a constructor parameter, e.g. 15s on the demo deployment), and the
/// default is triggered through the exact production path by anyone after the deadline.
contract AlibiCreditEscrow is PayoutAccounting, Ownable2Step, Pausable {
    enum Status {
        None,
        Open,
        Settled,
        Defaulted
    }

    struct Agreement {
        address payer;
        address creditor;
        address asset; // address(0) = native QIE
        bytes32 payerIdentity;
        uint256 total;
        uint256 bond;
        uint64 createdAt;
        uint64 deadline;
        Status status;
    }

    /// @notice A creditor's own risk rules. Anyone can set them for their own address; they bind every new agreement
    ///         naming that creditor. Zero values (the default) accept everything the registry allows.
    struct CreditorPolicy {
        uint16 minBondBps; // the payer must lock at least this share of the total up front
        uint8 minTier; // the payer's identity must have reached at least this tier (0 Unverified ... 3 Proven)
    }

    IAlibiRegistry public immutable registry;
    uint64 public immutable minDuration;
    uint64 public constant MAX_DURATION = 365 days;
    uint16 public constant KEEPER_BOUNTY_BPS = 50; // 0.5% of the bond
    uint16 public constant MAX_FEE_BPS = 100; // protocol fee can never exceed 1%
    uint256 private constant BPS = 10_000;

    uint16 public feeBps;
    address public feeRecipient;

    mapping(address => CreditorPolicy) public creditorPolicy;

    uint256 public nextAgreementId = 1;
    mapping(uint256 => Agreement) private _agreements;

    event CreditorPolicySet(address indexed creditor, uint16 minBondBps, uint8 minTier);

    event AgreementCreated(
        uint256 indexed agreementId,
        address indexed payer,
        address indexed creditor,
        address asset,
        uint256 total,
        uint256 bond,
        uint64 deadline,
        bytes32 payerIdentity,
        IAlibiRegistry.Tier tier
    );
    event AgreementSettled(uint256 indexed agreementId, address indexed payer, address indexed creditor, uint256 total, uint256 fee);
    event AgreementDefaulted(
        uint256 indexed agreementId,
        address indexed payer,
        address indexed creditor,
        uint256 bondPaid,
        uint256 stakeSeized,
        uint256 debtRecorded,
        address keeper,
        uint256 keeperBounty
    );
    event FeeSet(uint16 feeBps, address feeRecipient);

    error ZeroAddress();
    error InvalidParty();
    error InvalidAmount();
    error InvalidDuration();
    error ActiveDefault();
    error NotOpen();
    error NotPayer();
    error DeadlinePassed();
    error DeadlineNotReached();
    error FeeTooHigh();
    error OnlyRegistry();
    error BelowCreditorPolicy();
    error InvalidPolicy();

    constructor(address owner_, IAlibiRegistry registry_, uint64 minDuration_, uint16 feeBps_, address feeRecipient_)
        Ownable(owner_)
    {
        if (address(registry_) == address(0) || feeRecipient_ == address(0)) revert ZeroAddress();
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        if (minDuration_ == 0 || minDuration_ > MAX_DURATION) revert InvalidDuration();
        registry = registry_;
        minDuration = minDuration_;
        feeBps = feeBps_;
        feeRecipient = feeRecipient_;
        emit FeeSet(feeBps_, feeRecipient_);
    }

    /// @dev Native QIE seized from stake arrives here from the registry, and only from it.
    receive() external payable {
        if (msg.sender != address(registry)) revert OnlyRegistry();
    }

    function setFee(uint16 feeBps_, address feeRecipient_) external onlyOwner {
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        if (feeRecipient_ == address(0)) revert ZeroAddress();
        feeBps = feeBps_;
        feeRecipient = feeRecipient_;
        emit FeeSet(feeBps_, feeRecipient_);
    }

    // ------------------------------------------------------------------ views

    function getAgreement(uint256 id) external view returns (Agreement memory) {
        return _agreements[id];
    }

    /// @notice What bond would `payer` have to lock for a `total` deal right now?
    function quote(address payer, address asset, uint256 total)
        external
        view
        returns (uint256 bond, IAlibiRegistry.Tier tier)
    {
        return registry.quoteBond(registry.identityOf(payer), asset, total);
    }

    /// @notice Like `quote`, but also applies the creditor's own policy (higher bond, or a tier requirement).
    ///         Reverts with BelowCreditorPolicy if the payer's tier is below what the creditor requires.
    function quoteFor(address payer, address creditor, address asset, uint256 total)
        external
        view
        returns (uint256 bond, IAlibiRegistry.Tier tier)
    {
        return _bondFor(creditor, registry.identityOf(payer), asset, total);
    }

    function _bondFor(address creditor, bytes32 payerId, address asset, uint256 total)
        internal
        view
        returns (uint256 bond, IAlibiRegistry.Tier tier)
    {
        (bond, tier) = registry.quoteBond(payerId, asset, total);
        CreditorPolicy memory pol = creditorPolicy[creditor];
        if (uint8(tier) < pol.minTier) revert BelowCreditorPolicy();
        uint256 policyBond = (total * pol.minBondBps + BPS - 1) / BPS; // round up
        if (policyBond > bond) bond = policyBond;
    }

    /// @notice A creditor sets the minimum up-front bond share and minimum payer tier they will accept.
    function setCreditorPolicy(uint16 minBondBps, uint8 minTier) external {
        if (minBondBps > BPS || minTier > uint8(IAlibiRegistry.Tier.Proven)) revert InvalidPolicy();
        creditorPolicy[msg.sender] = CreditorPolicy(minBondBps, minTier);
        emit CreditorPolicySet(msg.sender, minBondBps, minTier);
    }

    /// @notice Emergency stop for NEW agreements only. Settling, defaulting and withdrawals are never paused,
    ///         so open agreements can always be repaid or defaulted.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function feeFor(uint256 total) public view returns (uint256) {
        return (total * feeBps) / BPS;
    }

    // ------------------------------------------------------------------ lifecycle

    /// @notice Open an agreement. Send exactly the quoted bond (native: as msg.value; ERC-20: approve first).
    function createAgreement(address creditor, address asset, uint256 total, uint64 duration)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint256 id, uint256 bond)
    {
        if (creditor == address(0) || creditor == msg.sender) revert InvalidParty();
        if (total == 0) revert InvalidAmount();
        if (duration < minDuration || duration > MAX_DURATION) revert InvalidDuration();

        bytes32 payerId = registry.identityOf(msg.sender);
        if (payerId != bytes32(0)) {
            // one person cannot be both sides of a deal through two of their own wallets
            if (registry.identityOf(creditor) == payerId) revert InvalidParty();
            if (registry.hasActiveDebt(payerId)) revert ActiveDefault();
        }

        IAlibiRegistry.Tier tier;
        (bond, tier) = _bondFor(creditor, payerId, asset, total);
        uint256 unsecured = total - bond;

        // effects
        id = nextAgreementId++;
        uint64 deadline = uint64(block.timestamp) + duration;
        _agreements[id] = Agreement({
            payer: msg.sender,
            creditor: creditor,
            asset: asset,
            payerIdentity: payerId,
            total: total,
            bond: bond,
            createdAt: uint64(block.timestamp),
            deadline: deadline,
            status: Status.Open
        });
        if (unsecured > 0) registry.reserveExposure(payerId, asset, unsecured);

        // interactions
        AssetTransferLib.pull(asset, msg.sender, bond);

        emit AgreementCreated(id, msg.sender, creditor, asset, total, bond, deadline, payerId, tier);
    }

    /// @notice Payer fulfils the post-paid remainder (plus fee) on or before the deadline.
    function settleAgreement(uint256 id) external payable nonReentrant {
        Agreement storage a = _agreements[id];
        if (a.status != Status.Open) revert NotOpen();
        if (msg.sender != a.payer) revert NotPayer();
        if (block.timestamp > a.deadline) revert DeadlinePassed();

        uint256 remaining = a.total - a.bond;
        uint256 fee = feeFor(a.total);
        a.status = Status.Settled;

        if (a.payerIdentity != bytes32(0)) {
            if (remaining > 0) registry.releaseExposure(a.payerIdentity, a.asset, remaining);
            registry.recordSettlement(a.payerIdentity, registry.identityOf(a.creditor), a.asset, a.total);
        }

        AssetTransferLib.pull(a.asset, msg.sender, remaining + fee);

        _payout(a.asset, a.creditor, a.total); // held bond + fresh remainder
        _payout(a.asset, feeRecipient, fee);

        emit AgreementSettled(id, a.payer, a.creditor, a.total, fee);
    }

    /// @notice Permissionless once the deadline has passed. The caller earns a small keeper bounty.
    function triggerDefault(uint256 id) external nonReentrant {
        Agreement storage a = _agreements[id];
        if (a.status != Status.Open) revert NotOpen();
        if (block.timestamp <= a.deadline) revert DeadlineNotReached();
        a.status = Status.Defaulted;

        uint256 unsecured = a.total - a.bond;
        uint256 bounty = (a.bond * KEEPER_BOUNTY_BPS) / BPS;
        uint256 seized;
        uint256 debt;

        if (unsecured > 0 && a.payerIdentity != bytes32(0)) {
            // 1) take the payer's stake first (it was posted exactly for this)
            seized = registry.slashStake(a.payerIdentity, a.asset, unsecured);
            if (seized > 0) registry.releaseExposure(a.payerIdentity, a.asset, seized);
            // 2) whatever stake could not cover becomes a FIFO debt claim, garnished from future inflows
            debt = unsecured - seized;
            registry.recordDefault(a.payerIdentity, id, a.creditor, a.asset, debt);
        }

        _payout(a.asset, a.creditor, a.bond - bounty + seized);
        _payout(a.asset, msg.sender, bounty);

        emit AgreementDefaulted(id, a.payer, a.creditor, a.bond - bounty, seized, debt, msg.sender, bounty);
    }
}
