// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAttestationVerifier} from "./interfaces/IAttestationVerifier.sol";
import {IAlibiRegistry} from "./interfaces/IAlibiRegistry.sol";
import {AssetTransferLib} from "./libraries/AssetTransferLib.sol";

/// @title AlibiIdentityRegistry
/// @notice Binds many wallets to ONE identity anchor, and keeps that identity's solvency state:
///         earned-credit tier, locked stake, open credit exposure, and the FIFO debt queue.
///
/// Design notes (the honest version):
///  * `identityId` is an opaque anchor chosen by the attestor from QIE's identity data (the .qie handle
///    or Pass ID). It is NOT a biometric "one human = one id" guarantee: QIE Pass may allow a person
///    to hold several QIE IDs. Alibi therefore never grants unsecured credit just because someone is
///    verified. New identities have no unsecured credit; it is earned (reputation) or backed (stake).
///  * Wallet links are irrevocable. A defaulter cannot unlink to escape the debt attached to the identity.
///  * Garnishment applies wherever value flows through the AlibiSlashingRouter (invoices, escrow
///    releases, integrated vaults/pools). It is not an L1 mechanism and cannot catch raw transfers.
contract AlibiIdentityRegistry is IAlibiRegistry, Ownable2Step, ReentrancyGuard {
    // ------------------------------------------------------------------ types

    struct Identity {
        uint64 firstLinkedAt;
        uint64 verifiedUntil; // KYC attestation expiry (0 = never verified)
        uint64 reputationSince; // start of the reputation clock (seedable on demo deployments)
        uint32 walletCount;
        uint32 settledDeals; // settled deals that count towards reputation
        uint32 uniqueCounterparties;
        uint32 defaultCount;
    }

    struct TierConfig {
        uint32 baseMinDeals;
        uint32 baseMinCounterparties;
        uint32 baseMinAge; // seconds since reputationSince
        uint32 provenMinDeals;
        uint32 provenMinCounterparties;
        uint32 provenMinAge;
        uint16 newFloorBps; // minimum bond for a verified identity (only stake can back the rest)
        uint16 baseFloorBps;
        uint16 provenFloorBps;
    }

    // ------------------------------------------------------------------ constants

    uint256 public constant MAX_ATTESTATION_TTL = 30 days;
    uint256 public constant MAX_CLOCK_SKEW = 5 minutes;
    uint256 public constant BPS = 10_000;

    // ------------------------------------------------------------------ state

    IAttestationVerifier public verifier;
    address public escrow;
    address public router;
    bool public modulesLocked;

    uint32 public maxWalletsPerIdentity = 10;
    TierConfig public tierConfig;

    mapping(address => bytes32) private _walletToIdentity;
    mapping(address => uint256) public attestationNonce;
    mapping(bytes32 => Identity) private _identities;
    mapping(bytes32 => mapping(bytes32 => bool)) public seenCounterparty;

    // credit configuration (owner-set, per asset)
    mapping(address => mapping(Tier => uint256)) public unsecuredCap; // asset => tier => max unsecured exposure
    mapping(address => uint256) public repMinDeal; // asset => min deal size that counts for reputation
    /// @notice Protocol-wide circuit breaker: the most unsecured exposure (open unsecured agreements + outstanding debt)
    ///         ALL identities together may hold per asset. Zero (the default) means no new unsecured credit at all.
    mapping(address => uint256) public globalUnsecuredCap;
    mapping(address => uint256) public globalUnsecuredExposure;

    // risk state
    mapping(bytes32 => mapping(address => uint256)) public stakeOf; // identity => asset => locked-able stake
    mapping(bytes32 => mapping(address => uint256)) public exposure; // open unsecured agreements + outstanding debt
    mapping(bytes32 => mapping(address => uint256)) public debtOutstanding;
    mapping(bytes32 => uint256) public openClaimCount;

    // FIFO queue per identity per asset (asset-separated: a claim in one asset can never block another)
    mapping(bytes32 => mapping(address => DebtClaim[])) private _claims;
    mapping(bytes32 => mapping(address => uint256)) private _head;

    // demo seeding (disabled forever with disableSeeding())
    bool public seedingEnabled = true;

    // ------------------------------------------------------------------ events

    event WalletLinked(bytes32 indexed identityId, address indexed wallet, bool kycVerified, uint64 verifiedUntil);
    event Staked(bytes32 indexed identityId, address indexed asset, uint256 amount, address indexed by);
    event StakeWithdrawn(bytes32 indexed identityId, address indexed asset, uint256 amount, address indexed to);
    event StakeSlashed(bytes32 indexed identityId, address indexed asset, uint256 amount);
    event ExposureChanged(bytes32 indexed identityId, address indexed asset, uint256 newExposure);
    event ReputationUpdated(bytes32 indexed identityId, uint32 settledDeals, uint32 uniqueCounterparties);
    event DefaultRecorded(
        bytes32 indexed identityId, uint256 indexed agreementId, address indexed creditor, address asset, uint256 debt
    );
    event DebtConsumed(
        bytes32 indexed identityId, address indexed asset, address indexed creditor, uint256 agreementId, uint256 amount
    );
    event VerifierSet(address verifier);
    event ModulesSet(address escrow, address router);
    event ModulesLocked();
    event TierConfigSet(TierConfig config);
    event GlobalUnsecuredCapSet(address indexed asset, uint256 cap);
    event UnsecuredCapSet(address indexed asset, Tier tier, uint256 cap);
    event RepMinDealSet(address indexed asset, uint256 minDeal);
    event MaxWalletsSet(uint32 max);
    event ReputationSeeded(bytes32 indexed identityId, uint32 deals, uint32 counterparties, uint64 since);
    event SeedingDisabled();

    // ------------------------------------------------------------------ errors

    error NotEscrow();
    error NotRouter();
    error ZeroAddress();
    error ZeroIdentity();
    error WalletMismatch();
    error BadNonce(uint256 got, uint256 expected);
    error AttestationExpired();
    error AttestationFromFuture();
    error AttestationTooLong();
    error InvalidAttestation();
    error WalletLinkedToOtherIdentity(bytes32 existing);
    error TooManyWallets();
    error NotLinked();
    error StakeLocked();
    error InsufficientStake();
    error ModulesAlreadyLocked();
    error SeedingIsDisabled();
    error InvalidConfig();

    // ------------------------------------------------------------------ modifiers

    modifier onlyEscrow() {
        if (msg.sender != escrow) revert NotEscrow();
        _;
    }

    modifier onlyRouter() {
        if (msg.sender != router) revert NotRouter();
        _;
    }

    // ------------------------------------------------------------------ constructor / admin

    constructor(address owner_, IAttestationVerifier verifier_) Ownable(owner_) {
        if (address(verifier_) == address(0)) revert ZeroAddress();
        verifier = verifier_;
        tierConfig = TierConfig({
            baseMinDeals: 3,
            baseMinCounterparties: 2,
            baseMinAge: 7 days,
            provenMinDeals: 10,
            provenMinCounterparties: 4,
            provenMinAge: 30 days,
            newFloorBps: 1000,
            baseFloorBps: 2500,
            provenFloorBps: 1000
        });
        emit VerifierSet(address(verifier_));
    }

    /// @notice Swap the verification mechanism (e.g. to a native QIE on-chain credential verifier).
    function setVerifier(IAttestationVerifier verifier_) external onlyOwner {
        if (address(verifier_) == address(0)) revert ZeroAddress();
        verifier = verifier_;
        emit VerifierSet(address(verifier_));
    }

    function setModules(address escrow_, address router_) external onlyOwner {
        if (modulesLocked) revert ModulesAlreadyLocked();
        if (escrow_ == address(0) || router_ == address(0)) revert ZeroAddress();
        escrow = escrow_;
        router = router_;
        emit ModulesSet(escrow_, router_);
    }

    /// @notice Freeze the escrow/router addresses. Do this before mainnet launch.
    function lockModules() external onlyOwner {
        modulesLocked = true;
        emit ModulesLocked();
    }

    function setTierConfig(TierConfig calldata c) external onlyOwner {
        if (c.newFloorBps > BPS || c.baseFloorBps > BPS || c.provenFloorBps > BPS || c.provenFloorBps > c.baseFloorBps) {
            revert InvalidConfig();
        }
        tierConfig = c;
        emit TierConfigSet(c);
    }

    function setUnsecuredCap(address asset, Tier tier, uint256 cap) external onlyOwner {
        unsecuredCap[asset][tier] = cap;
        emit UnsecuredCapSet(asset, tier, cap);
    }

    function setGlobalUnsecuredCap(address asset, uint256 cap) external onlyOwner {
        globalUnsecuredCap[asset] = cap;
        emit GlobalUnsecuredCapSet(asset, cap);
    }

    function setRepMinDeal(address asset, uint256 minDeal) external onlyOwner {
        repMinDeal[asset] = minDeal;
        emit RepMinDealSet(asset, minDeal);
    }

    function setMaxWalletsPerIdentity(uint32 max_) external onlyOwner {
        if (max_ == 0 || max_ > 50) revert InvalidConfig();
        maxWalletsPerIdentity = max_;
        emit MaxWalletsSet(max_);
    }

    /// @notice DEMO ONLY. Lets the owner give an identity a reputation head-start so the Judge Sandbox can
    ///         show the earned-credit tiers without waiting weeks. Emits a public event and is switched
    ///         off permanently by `disableSeeding()`. Real deployments should call that before launch.
    function seedReputation(bytes32 identityId, uint32 deals, uint32 counterparties, uint64 since) external onlyOwner {
        if (!seedingEnabled) revert SeedingIsDisabled();
        if (identityId == bytes32(0)) revert ZeroIdentity();
        Identity storage i = _identities[identityId];
        i.settledDeals = deals;
        i.uniqueCounterparties = counterparties;
        i.reputationSince = since;
        emit ReputationSeeded(identityId, deals, counterparties, since);
    }

    function disableSeeding() external onlyOwner {
        seedingEnabled = false;
        emit SeedingDisabled();
    }

    // ------------------------------------------------------------------ linking

    /// @notice Bind msg.sender to the identity in a valid attestation. Irrevocable by design.
    function linkWallet(IAttestationVerifier.Attestation calldata att, bytes calldata signature) external {
        if (msg.sender != att.wallet) revert WalletMismatch();
        if (att.identityId == bytes32(0)) revert ZeroIdentity();

        uint256 expectedNonce = attestationNonce[att.wallet];
        if (att.nonce != expectedNonce) revert BadNonce(att.nonce, expectedNonce);
        if (att.expiresAt <= block.timestamp) revert AttestationExpired();
        if (att.issuedAt > block.timestamp + MAX_CLOCK_SKEW) revert AttestationFromFuture();
        if (att.expiresAt - att.issuedAt > MAX_ATTESTATION_TTL) revert AttestationTooLong();
        if (!verifier.verify(att, signature)) revert InvalidAttestation();

        attestationNonce[att.wallet] = expectedNonce + 1;

        bytes32 existing = _walletToIdentity[att.wallet];
        if (existing != bytes32(0) && existing != att.identityId) revert WalletLinkedToOtherIdentity(existing);

        Identity storage i = _identities[att.identityId];
        if (existing == bytes32(0)) {
            if (i.walletCount >= maxWalletsPerIdentity) revert TooManyWallets();
            _walletToIdentity[att.wallet] = att.identityId;
            i.walletCount += 1;
            if (i.firstLinkedAt == 0) {
                i.firstLinkedAt = uint64(block.timestamp);
                if (i.reputationSince == 0) i.reputationSince = uint64(block.timestamp);
            }
        }
        if (att.kycVerified && att.expiresAt > i.verifiedUntil) i.verifiedUntil = att.expiresAt;

        emit WalletLinked(att.identityId, att.wallet, att.kycVerified, i.verifiedUntil);
    }

    // ------------------------------------------------------------------ stake

    /// @notice Lock stake behind your identity. Stake is the only way a brand-new identity can obtain
    ///         unsecured credit, and it is seized first when that credit defaults.
    function stake(address asset, uint256 amount) external payable nonReentrant {
        bytes32 id = _walletToIdentity[msg.sender];
        if (id == bytes32(0)) revert NotLinked();
        AssetTransferLib.pull(asset, msg.sender, amount);
        stakeOf[id][asset] += amount;
        emit Staked(id, asset, amount, msg.sender);
    }

    /// @notice Withdraw stake that is not currently needed to back open exposure.
    function withdrawStake(address asset, uint256 amount) external nonReentrant {
        bytes32 id = _walletToIdentity[msg.sender];
        if (id == bytes32(0)) revert NotLinked();
        uint256 s = stakeOf[id][asset];
        if (amount > s) revert InsufficientStake();
        uint256 cap = unsecuredCap[asset][tierOf(id)];
        uint256 used = exposure[id][asset];
        uint256 needed = used > cap ? used - cap : 0;
        if (s - amount < needed) revert StakeLocked();
        stakeOf[id][asset] = s - amount;
        AssetTransferLib.push(asset, msg.sender, amount);
        emit StakeWithdrawn(id, asset, amount, msg.sender);
    }

    // ------------------------------------------------------------------ reads

    function identityOf(address wallet) public view returns (bytes32) {
        return _walletToIdentity[wallet];
    }

    function getIdentity(bytes32 id) external view returns (Identity memory) {
        return _identities[id];
    }

    function isVerified(bytes32 id) public view returns (bool) {
        return id != bytes32(0) && block.timestamp <= _identities[id].verifiedUntil;
    }

    function hasActiveDebt(bytes32 id) public view returns (bool) {
        return openClaimCount[id] > 0;
    }

    function walletHasActiveDebt(address wallet) external view returns (bool) {
        return openClaimCount[_walletToIdentity[wallet]] > 0;
    }

    function tierOf(bytes32 id) public view returns (Tier) {
        if (!isVerified(id)) return Tier.Unverified;
        Identity storage i = _identities[id];
        if (i.defaultCount > 0) return Tier.New;
        TierConfig memory c = tierConfig;
        uint256 age = block.timestamp > i.reputationSince ? block.timestamp - i.reputationSince : 0;
        if (i.settledDeals >= c.provenMinDeals && i.uniqueCounterparties >= c.provenMinCounterparties && age >= c.provenMinAge)
        {
            return Tier.Proven;
        }
        if (i.settledDeals >= c.baseMinDeals && i.uniqueCounterparties >= c.baseMinCounterparties && age >= c.baseMinAge) {
            return Tier.Base;
        }
        return Tier.New;
    }

    function floorBps(Tier t) public view returns (uint16) {
        if (t == Tier.Proven) return tierConfig.provenFloorBps;
        if (t == Tier.Base) return tierConfig.baseFloorBps;
        if (t == Tier.New) return tierConfig.newFloorBps;
        return uint16(BPS);
    }

    /// @notice Spare unsecured capacity for (identity, asset): earned cap + stake - exposure.
    function freeCapacity(bytes32 id, address asset) public view returns (uint256) {
        if (!isVerified(id) || hasActiveDebt(id)) return 0;
        uint256 capacity = unsecuredCap[asset][tierOf(id)] + stakeOf[id][asset];
        uint256 used = exposure[id][asset];
        uint256 free = capacity > used ? capacity - used : 0;
        // the identity's room can never exceed what is left under the protocol-wide limit
        uint256 gCap = globalUnsecuredCap[asset];
        uint256 gUsed = globalUnsecuredExposure[asset];
        uint256 gFree = gCap > gUsed ? gCap - gUsed : 0;
        return free < gFree ? free : gFree;
    }

    /// @notice The upfront bond required for a `total` deal: the tier's floor, raised until the
    ///         unsecured remainder fits inside the identity's free capacity.
    function quoteBond(bytes32 id, address asset, uint256 total) external view returns (uint256 bond, Tier tier) {
        tier = tierOf(id);
        if (tier == Tier.Unverified || hasActiveDebt(id)) return (total, tier);
        bond = (total * floorBps(tier) + BPS - 1) / BPS; // round up: never under-collateralize via rounding
        uint256 unsecured = total - bond;
        uint256 free = freeCapacity(id, asset);
        if (unsecured > free) {
            unsecured = free;
            bond = total - unsecured;
        }
    }

    function getWalletSolvency(address wallet)
        external
        view
        returns (bytes32 identityId, bool activeDebt, uint256 openClaims, Tier tier, uint16 currentFloorBps)
    {
        identityId = _walletToIdentity[wallet];
        openClaims = openClaimCount[identityId];
        activeDebt = openClaims > 0;
        tier = tierOf(identityId);
        currentFloorBps = floorBps(tier);
    }

    function getOpenClaims(bytes32 id, address asset) external view returns (DebtClaim[] memory out) {
        DebtClaim[] storage q = _claims[id][asset];
        uint256 h = _head[id][asset];
        out = new DebtClaim[](q.length - h);
        for (uint256 k = 0; k < out.length; k++) {
            out[k] = q[h + k];
        }
    }

    // ------------------------------------------------------------------ escrow hooks

    function reserveExposure(bytes32 id, address asset, uint256 amount) external onlyEscrow {
        exposure[id][asset] += amount;
        globalUnsecuredExposure[asset] += amount;
        emit ExposureChanged(id, asset, exposure[id][asset]);
    }

    function releaseExposure(bytes32 id, address asset, uint256 amount) external onlyEscrow {
        exposure[id][asset] -= amount;
        globalUnsecuredExposure[asset] -= amount;
        emit ExposureChanged(id, asset, exposure[id][asset]);
    }

    function recordSettlement(bytes32 payerId, bytes32 creditorId, address asset, uint256 total) external onlyEscrow {
        if (payerId == bytes32(0) || creditorId == bytes32(0) || creditorId == payerId) return;
        // Reputation only comes from deals with a DIFFERENT, currently-verified identity,
        // above a minimum size: self-dealing between one's own wallets earns nothing.
        if (!isVerified(creditorId)) return;
        if (total < repMinDeal[asset]) return;
        Identity storage p = _identities[payerId];
        p.settledDeals += 1;
        if (!seenCounterparty[payerId][creditorId]) {
            seenCounterparty[payerId][creditorId] = true;
            p.uniqueCounterparties += 1;
        }
        emit ReputationUpdated(payerId, p.settledDeals, p.uniqueCounterparties);
    }

    /// @notice Seize stake (up to `maxAmount`) and send it to the escrow, which pays the creditor.
    function slashStake(bytes32 id, address asset, uint256 maxAmount) external onlyEscrow nonReentrant returns (uint256 seized) {
        uint256 s = stakeOf[id][asset];
        seized = s < maxAmount ? s : maxAmount;
        if (seized == 0) return 0;
        stakeOf[id][asset] = s - seized;
        emit StakeSlashed(id, asset, seized);
        AssetTransferLib.push(asset, msg.sender, seized);
    }

    function recordDefault(bytes32 id, uint256 agreementId, address creditor, address asset, uint256 debt)
        external
        onlyEscrow
    {
        _identities[id].defaultCount += 1;
        if (debt == 0) return;
        _claims[id][asset].push(
            DebtClaim({agreementId: agreementId, creditor: creditor, remaining: debt, createdAt: uint64(block.timestamp)})
        );
        openClaimCount[id] += 1;
        debtOutstanding[id][asset] += debt;
        emit DefaultRecorded(id, agreementId, creditor, asset, debt);
    }

    // ------------------------------------------------------------------ router hook

    struct Payouts {
        address[] creditors;
        uint256[] amounts;
        uint256[] agreementIds;
        uint256 total;
    }

    /// @notice Waterfall: pay the oldest claim first, then the next, up to `available` and `maxClaims`.
    ///         Only state changes here; the router moves the money.
    function consumeDebt(bytes32 id, address asset, uint256 available, uint256 maxClaims)
        external
        onlyRouter
        returns (address[] memory, uint256[] memory, uint256[] memory, uint256)
    {
        Payouts memory p = _waterfall(id, asset, available, maxClaims);
        return (p.creditors, p.amounts, p.agreementIds, p.total);
    }

    function _waterfall(bytes32 id, address asset, uint256 available, uint256 maxClaims)
        private
        returns (Payouts memory p)
    {
        DebtClaim[] storage q = _claims[id][asset];
        uint256 i = _head[id][asset];
        uint256 size = q.length - i;
        if (size > maxClaims) size = maxClaims;

        p.creditors = new address[](size);
        p.amounts = new uint256[](size);
        p.agreementIds = new uint256[](size);

        uint256 filled;
        while (i < q.length && available > 0 && filled < size) {
            uint256 take = q[i].remaining < available ? q[i].remaining : available;
            q[i].remaining -= take;
            available -= take;
            p.total += take;
            p.creditors[filled] = q[i].creditor;
            p.amounts[filled] = take;
            p.agreementIds[filled] = q[i].agreementId;
            emit DebtConsumed(id, asset, q[i].creditor, q[i].agreementId, take);
            filled++;
            if (q[i].remaining == 0) {
                i++;
                openClaimCount[id] -= 1;
            } else {
                break; // `available` is exhausted
            }
        }
        _head[id][asset] = i;

        if (p.total > 0) {
            debtOutstanding[id][asset] -= p.total;
            exposure[id][asset] -= p.total;
            globalUnsecuredExposure[asset] -= p.total;
            emit ExposureChanged(id, asset, exposure[id][asset]);
        }

        // shrink the arrays to the number of claims actually touched
        address[] memory cr = p.creditors;
        uint256[] memory am = p.amounts;
        uint256[] memory ag = p.agreementIds;
        assembly {
            mstore(cr, filled)
            mstore(am, filled)
            mstore(ag, filled)
        }
    }
}
