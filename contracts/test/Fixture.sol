// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IAttestationVerifier} from "../src/interfaces/IAttestationVerifier.sol";
import {IAlibiRegistry} from "../src/interfaces/IAlibiRegistry.sol";
import {Eip712AttestationVerifier} from "../src/Eip712AttestationVerifier.sol";
import {AlibiIdentityRegistry} from "../src/AlibiIdentityRegistry.sol";
import {AlibiCreditEscrow} from "../src/AlibiCreditEscrow.sol";
import {AlibiSlashingRouter} from "../src/AlibiSlashingRouter.sol";
import {MockERC20} from "./mocks/Mocks.sol";

/// @dev Shared deployment + helpers for every test.
abstract contract Fixture is Test {
    address internal constant NATIVE = address(0);

    uint256 internal attestorPk = 0xA11CE;
    address internal attestor;
    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal keeper = makeAddr("keeper");

    // identities
    bytes32 internal constant ALICE = keccak256("qie-id:alice.qie");
    bytes32 internal constant BOB = keccak256("qie-id:bob.qie");
    bytes32 internal constant CAROL = keccak256("qie-id:carol.qie");
    bytes32 internal constant DAVE = keccak256("qie-id:dave.qie");

    // wallets
    address internal alice1 = makeAddr("alice1");
    address internal alice2 = makeAddr("alice2");
    address internal bob1 = makeAddr("bob1");
    address internal carol1 = makeAddr("carol1");
    address internal dave1 = makeAddr("dave1");
    address internal merchant = makeAddr("merchant"); // unlinked creditor
    address internal merchant2 = makeAddr("merchant2");
    address internal payer = makeAddr("payer"); // unlinked third party paying Alice

    Eip712AttestationVerifier internal verifier;
    AlibiIdentityRegistry internal registry;
    AlibiCreditEscrow internal escrow;
    AlibiSlashingRouter internal router;
    MockERC20 internal usdc;

    uint64 internal constant MIN_DURATION = 15;
    uint16 internal constant FEE_BPS = 50;
    uint256 internal constant MAX_CLAIMS = 3;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        attestor = vm.addr(attestorPk);
        usdc = new MockERC20();

        verifier = new Eip712AttestationVerifier(owner, attestor);
        registry = new AlibiIdentityRegistry(owner, verifier);
        escrow = new AlibiCreditEscrow(owner, registry, MIN_DURATION, FEE_BPS, treasury);
        router = new AlibiSlashingRouter(registry, MAX_CLAIMS);

        vm.startPrank(owner);
        registry.setModules(address(escrow), address(router));
        registry.setUnsecuredCap(NATIVE, IAlibiRegistry.Tier.Base, 200 ether);
        registry.setUnsecuredCap(NATIVE, IAlibiRegistry.Tier.Proven, 2_000 ether);
        registry.setUnsecuredCap(address(usdc), IAlibiRegistry.Tier.Base, 200 ether);
        registry.setUnsecuredCap(address(usdc), IAlibiRegistry.Tier.Proven, 2_000 ether);
        registry.setGlobalUnsecuredCap(NATIVE, 1_000_000 ether);
        registry.setGlobalUnsecuredCap(address(usdc), 1_000_000 ether);
        registry.setRepMinDeal(NATIVE, 1 ether);
        registry.setRepMinDeal(address(usdc), 1 ether);
        vm.stopPrank();

        vm.deal(alice1, 100_000 ether);
        vm.deal(alice2, 100_000 ether);
        vm.deal(bob1, 100_000 ether);
        vm.deal(carol1, 100_000 ether);
        vm.deal(dave1, 100_000 ether);
        vm.deal(payer, 100_000 ether);
        vm.deal(merchant, 1 ether);
        usdc.mint(alice1, 100_000 ether);
        usdc.mint(payer, 100_000 ether);
    }

    // ------------------------------------------------------------ helpers

    function _attestation(address wallet, bytes32 id, bool kyc, uint64 ttl)
        internal
        view
        returns (IAttestationVerifier.Attestation memory att)
    {
        att = IAttestationVerifier.Attestation({
            wallet: wallet,
            identityId: id,
            kycVerified: kyc,
            issuedAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp) + ttl,
            nonce: registry.attestationNonce(wallet)
        });
    }

    function _sign(uint256 pk, IAttestationVerifier.Attestation memory att) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, verifier.hashAttestation(att));
        return abi.encodePacked(r, s, v);
    }

    function _link(address wallet, bytes32 id) internal {
        _linkWith(wallet, id, true, 7 days);
    }

    function _linkWith(address wallet, bytes32 id, bool kyc, uint64 ttl) internal {
        IAttestationVerifier.Attestation memory att = _attestation(wallet, id, kyc, ttl);
        bytes memory sig = _sign(attestorPk, att);
        vm.prank(wallet);
        registry.linkWallet(att, sig);
    }

    /// @dev give an identity a "Proven" reputation head-start (what the demo seeding does)
    function _seedProven(bytes32 id) internal {
        vm.prank(owner);
        registry.seedReputation(id, 10, 4, uint64(block.timestamp - 31 days));
    }

    function _open(address from, address creditor, address asset, uint256 total, uint64 duration)
        internal
        returns (uint256 id, uint256 bond)
    {
        (bond,) = escrow.quote(from, asset, total);
        vm.prank(from);
        if (asset == NATIVE) {
            (id, bond) = escrow.createAgreement{value: bond}(creditor, asset, total, duration);
        } else {
            (id, bond) = escrow.createAgreement(creditor, asset, total, duration);
        }
    }

    function _defaultIt(uint256 id) internal {
        AlibiCreditEscrow.Agreement memory a = escrow.getAgreement(id);
        vm.warp(a.deadline + 1);
        vm.prank(keeper);
        escrow.triggerDefault(id);
    }
}
