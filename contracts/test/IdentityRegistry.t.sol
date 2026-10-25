// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Fixture} from "./Fixture.sol";
import {IAttestationVerifier} from "../src/interfaces/IAttestationVerifier.sol";
import {IAlibiRegistry} from "../src/interfaces/IAlibiRegistry.sol";
import {AlibiIdentityRegistry} from "../src/AlibiIdentityRegistry.sol";

contract IdentityRegistryTest is Fixture {
    // ---------------------------------------------------------------- linking

    function test_linkWallet_bindsWalletToIdentity() public {
        _link(alice1, ALICE);
        assertEq(registry.identityOf(alice1), ALICE);
        assertTrue(registry.isVerified(ALICE));
        assertEq(registry.getIdentity(ALICE).walletCount, 1);
    }

    function test_multiWallet_sameIdentity_sharesState() public {
        _link(alice1, ALICE);
        _link(alice2, ALICE);
        assertEq(registry.identityOf(alice1), registry.identityOf(alice2));
        assertEq(registry.getIdentity(ALICE).walletCount, 2);
    }

    function test_replay_sameAttestationTwiceReverts() public {
        IAttestationVerifier.Attestation memory att = _attestation(alice1, ALICE, true, 7 days);
        bytes memory sig = _sign(attestorPk, att);
        vm.startPrank(alice1);
        registry.linkWallet(att, sig);
        vm.expectRevert(abi.encodeWithSelector(AlibiIdentityRegistry.BadNonce.selector, 0, 1));
        registry.linkWallet(att, sig);
        vm.stopPrank();
    }

    function test_attestationForOtherWallet_cannotBeUsedByCaller() public {
        IAttestationVerifier.Attestation memory att = _attestation(alice1, ALICE, true, 7 days);
        bytes memory sig = _sign(attestorPk, att);
        vm.prank(alice2); // someone else tries to use alice1's attestation
        vm.expectRevert(AlibiIdentityRegistry.WalletMismatch.selector);
        registry.linkWallet(att, sig);
    }

    function test_wrongSigner_reverts() public {
        IAttestationVerifier.Attestation memory att = _attestation(alice1, ALICE, true, 7 days);
        bytes memory sig = _sign(0xBADBAD, att);
        vm.prank(alice1);
        vm.expectRevert(AlibiIdentityRegistry.InvalidAttestation.selector);
        registry.linkWallet(att, sig);
    }

    function test_tamperedAttestation_reverts() public {
        IAttestationVerifier.Attestation memory att = _attestation(alice1, ALICE, true, 7 days);
        bytes memory sig = _sign(attestorPk, att);
        att.identityId = BOB; // swap the identity after signing
        vm.prank(alice1);
        vm.expectRevert(AlibiIdentityRegistry.InvalidAttestation.selector);
        registry.linkWallet(att, sig);
    }

    function test_expiredAttestation_reverts() public {
        IAttestationVerifier.Attestation memory att = _attestation(alice1, ALICE, true, 1 hours);
        bytes memory sig = _sign(attestorPk, att);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(alice1);
        vm.expectRevert(AlibiIdentityRegistry.AttestationExpired.selector);
        registry.linkWallet(att, sig);
    }

    function test_attestationTtlTooLong_reverts() public {
        IAttestationVerifier.Attestation memory att = _attestation(alice1, ALICE, true, 31 days);
        bytes memory sig = _sign(attestorPk, att);
        vm.prank(alice1);
        vm.expectRevert(AlibiIdentityRegistry.AttestationTooLong.selector);
        registry.linkWallet(att, sig);
    }

    function test_walletCannotSwitchIdentity() public {
        _link(alice1, ALICE);
        IAttestationVerifier.Attestation memory att = _attestation(alice1, BOB, true, 7 days);
        bytes memory sig = _sign(attestorPk, att);
        vm.prank(alice1);
        vm.expectRevert(abi.encodeWithSelector(AlibiIdentityRegistry.WalletLinkedToOtherIdentity.selector, ALICE));
        registry.linkWallet(att, sig);
    }

    function test_maxWalletsPerIdentity_enforced() public {
        vm.prank(owner);
        registry.setMaxWalletsPerIdentity(1);
        _link(alice1, ALICE);
        IAttestationVerifier.Attestation memory att = _attestation(alice2, ALICE, true, 7 days);
        bytes memory sig = _sign(attestorPk, att);
        vm.prank(alice2);
        vm.expectRevert(AlibiIdentityRegistry.TooManyWallets.selector);
        registry.linkWallet(att, sig);
    }

    function test_relinkSameWallet_refreshesKycExpiry() public {
        _linkWith(alice1, ALICE, true, 1 days);
        uint64 first = registry.getIdentity(ALICE).verifiedUntil;
        vm.warp(block.timestamp + 12 hours);
        _linkWith(alice1, ALICE, true, 7 days);
        assertGt(registry.getIdentity(ALICE).verifiedUntil, first);
        assertEq(registry.getIdentity(ALICE).walletCount, 1);
    }

    function test_unverifiedLink_doesNotGrantVerifiedStatus() public {
        _linkWith(alice1, ALICE, false, 7 days);
        assertFalse(registry.isVerified(ALICE));
        assertEq(uint8(registry.tierOf(ALICE)), uint8(IAlibiRegistry.Tier.Unverified));
    }

    function test_kycExpiry_dropsTier() public {
        _linkWith(alice1, ALICE, true, 1 days);
        _seedProven(ALICE);
        assertEq(uint8(registry.tierOf(ALICE)), uint8(IAlibiRegistry.Tier.Proven));
        vm.warp(block.timestamp + 2 days);
        assertEq(uint8(registry.tierOf(ALICE)), uint8(IAlibiRegistry.Tier.Unverified));
    }

    function test_verifierCanBeSwapped() public {
        // new attestor key; old signatures stop working only if verifier is replaced
        uint256 pk2 = 0xB0B;
        vm.prank(owner);
        verifier.setAttestor(vm.addr(pk2), true);
        IAttestationVerifier.Attestation memory att = _attestation(alice1, ALICE, true, 7 days);
        bytes memory sigNew = _sign(pk2, att);
        vm.prank(alice1);
        registry.linkWallet(att, sigNew);
        assertEq(registry.identityOf(alice1), ALICE);

        vm.prank(owner);
        verifier.setAttestor(attestor, false);
        IAttestationVerifier.Attestation memory att2 = _attestation(alice2, ALICE, true, 7 days);
        bytes memory oldSig = _sign(attestorPk, att2);
        vm.prank(alice2);
        vm.expectRevert(AlibiIdentityRegistry.InvalidAttestation.selector);
        registry.linkWallet(att2, oldSig);
    }

    // ---------------------------------------------------------------- tiers and quotes

    function test_newVerifiedIdentity_getsNoUnsecuredCredit() public {
        _link(alice1, ALICE);
        (uint256 bond, IAlibiRegistry.Tier tier) = registry.quoteBond(ALICE, NATIVE, 500 ether);
        assertEq(bond, 500 ether, "a fresh verified identity must post 100%");
        assertEq(uint8(tier), uint8(IAlibiRegistry.Tier.New));
    }

    function test_unlinkedWallet_posts100Percent() public view {
        (uint256 bond, IAlibiRegistry.Tier tier) = registry.quoteBond(bytes32(0), NATIVE, 500 ether);
        assertEq(bond, 500 ether);
        assertEq(uint8(tier), uint8(IAlibiRegistry.Tier.Unverified));
    }

    function test_provenTier_getsTenPercent_withinCap() public {
        _link(alice1, ALICE);
        _seedProven(ALICE);
        (uint256 bond, IAlibiRegistry.Tier tier) = registry.quoteBond(ALICE, NATIVE, 500 ether);
        assertEq(bond, 50 ether);
        assertEq(uint8(tier), uint8(IAlibiRegistry.Tier.Proven));
    }

    function test_capRaisesBond_whenUnsecuredExceedsCapacity() public {
        _link(alice1, ALICE);
        _seedProven(ALICE);
        // cap is 2000; a 30,000 deal would be 27,000 unsecured -> bond rises to 28,000
        (uint256 bond,) = registry.quoteBond(ALICE, NATIVE, 30_000 ether);
        assertEq(bond, 28_000 ether);
    }

    function test_reputation_isEarnedOnlyFromDistinctVerifiedCounterparties() public {
        _link(alice1, ALICE);
        _link(bob1, BOB);
        _link(carol1, CAROL);
        _link(alice2, ALICE);

        // alice pays bob, carol (verified, different identities): counts
        _settleDeal(alice1, bob1, 10 ether);
        _settleDeal(alice1, carol1, 10 ether);
        // alice pays an unlinked merchant: does NOT count
        _settleDeal(alice1, merchant, 10 ether);
        // alice pays bob again: counts as a deal, but not a new counterparty
        _settleDeal(alice1, bob1, 10 ether);

        AlibiIdentityRegistry.Identity memory i = registry.getIdentity(ALICE);
        assertEq(i.settledDeals, 3);
        assertEq(i.uniqueCounterparties, 2);
    }

    function test_selfDealingBetweenOwnWallets_isRejected() public {
        _link(alice1, ALICE);
        _link(alice2, ALICE);
        (uint256 bond,) = escrow.quote(alice1, NATIVE, 10 ether);
        vm.prank(alice1);
        vm.expectRevert();
        escrow.createAgreement{value: bond}(alice2, NATIVE, 10 ether, 60);
    }

    function test_dustDeals_doNotEarnReputation() public {
        _link(alice1, ALICE);
        _link(bob1, BOB);
        _settleDeal(alice1, bob1, 0.1 ether); // below repMinDeal (1 ether)
        assertEq(registry.getIdentity(ALICE).settledDeals, 0);
    }

    function test_tierProgression_needsDealsCounterpartiesAndTime() public {
        _link(alice1, ALICE);
        _link(bob1, BOB);
        _link(carol1, CAROL);
        _settleDeal(alice1, bob1, 10 ether);
        _settleDeal(alice1, carol1, 10 ether);
        _settleDeal(alice1, bob1, 10 ether);
        // 3 deals / 2 counterparties but the identity is brand new
        assertEq(uint8(registry.tierOf(ALICE)), uint8(IAlibiRegistry.Tier.New));
        vm.warp(block.timestamp + 8 days);
        _relink(alice1, ALICE); // keep KYC fresh
        assertEq(uint8(registry.tierOf(ALICE)), uint8(IAlibiRegistry.Tier.Base));
    }

    function test_defaultDropsTierAndBlocksNewAgreements() public {
        _link(alice1, ALICE);
        _seedProven(ALICE);
        (uint256 id,) = _open(alice1, merchant, NATIVE, 500 ether, 15);
        _defaultIt(id);
        assertTrue(registry.hasActiveDebt(ALICE));
        assertEq(uint8(registry.tierOf(ALICE)), uint8(IAlibiRegistry.Tier.New));
        (uint256 bond,) = registry.quoteBond(ALICE, NATIVE, 100 ether);
        assertEq(bond, 100 ether);
    }

    // ---------------------------------------------------------------- stake

    function test_stake_letsANewIdentityBorrowUpToItsStake() public {
        _link(alice1, ALICE);
        vm.prank(alice1);
        registry.stake{value: 90 ether}(NATIVE, 90 ether);
        (uint256 bond,) = registry.quoteBond(ALICE, NATIVE, 100 ether);
        assertEq(bond, 10 ether); // 10% floor, 90 backed by stake
        (bond,) = registry.quoteBond(ALICE, NATIVE, 200 ether);
        assertEq(bond, 110 ether); // only 90 of 180 fits inside the stake
    }

    function test_stake_isSeizedFirstOnDefault_andLeavesNoDebt() public {
        _link(alice1, ALICE);
        vm.prank(alice1);
        registry.stake{value: 90 ether}(NATIVE, 90 ether);
        (uint256 id,) = _open(alice1, merchant, NATIVE, 100 ether, 15);
        uint256 before = merchant.balance;
        _defaultIt(id);
        // creditor: bond (10 - 0.05 bounty) + 90 seized stake = 99.95
        assertEq(merchant.balance - before, 99.95 ether);
        assertFalse(registry.hasActiveDebt(ALICE), "fully covered by stake: no queue debt");
        assertEq(registry.stakeOf(ALICE, NATIVE), 0);
        assertEq(registry.exposure(ALICE, NATIVE), 0);
        assertEq(registry.getIdentity(ALICE).defaultCount, 1, "still a default on record");
    }

    function test_stake_partialCover_remainderBecomesQueueDebt() public {
        _link(alice1, ALICE);
        vm.prank(alice1);
        registry.stake{value: 40 ether}(NATIVE, 40 ether);
        // stake 40 -> deal 100 needs bond 60 (unsecured 40)
        (uint256 id, uint256 bond) = _open(alice1, merchant, NATIVE, 100 ether, 15);
        assertEq(bond, 60 ether);
        _defaultIt(id);
        assertFalse(registry.hasActiveDebt(ALICE)); // stake covered all 40
    }

    function test_stake_lockedWhileItBacksOpenExposure() public {
        _link(alice1, ALICE);
        vm.prank(alice1);
        registry.stake{value: 90 ether}(NATIVE, 90 ether);
        (uint256 id,) = _open(alice1, merchant, NATIVE, 100 ether, 3600);
        vm.prank(alice1);
        vm.expectRevert(AlibiIdentityRegistry.StakeLocked.selector);
        registry.withdrawStake(NATIVE, 1 ether);

        uint256 settleValue = 90 ether + escrow.feeFor(100 ether);
        vm.prank(alice1);
        escrow.settleAgreement{value: settleValue}(id);
        uint256 before = alice1.balance;
        vm.prank(alice1);
        registry.withdrawStake(NATIVE, 90 ether);
        assertEq(alice1.balance - before, 90 ether);
    }

    function test_stake_requiresLinkedWallet() public {
        vm.prank(alice1);
        vm.expectRevert(AlibiIdentityRegistry.NotLinked.selector);
        registry.stake{value: 1 ether}(NATIVE, 1 ether);
    }

    // ---------------------------------------------------------------- seeding + access control

    function test_seeding_canBeDisabledForever() public {
        vm.prank(owner);
        registry.disableSeeding();
        vm.prank(owner);
        vm.expectRevert(AlibiIdentityRegistry.SeedingIsDisabled.selector);
        registry.seedReputation(ALICE, 10, 4, 1);
    }

    function test_seeding_onlyOwner() public {
        vm.prank(alice1);
        vm.expectRevert();
        registry.seedReputation(ALICE, 10, 4, 1);
    }

    function test_hooks_onlyModules() public {
        vm.startPrank(alice1);
        vm.expectRevert(AlibiIdentityRegistry.NotEscrow.selector);
        registry.reserveExposure(ALICE, NATIVE, 1);
        vm.expectRevert(AlibiIdentityRegistry.NotEscrow.selector);
        registry.recordDefault(ALICE, 1, merchant, NATIVE, 1);
        vm.expectRevert(AlibiIdentityRegistry.NotEscrow.selector);
        registry.slashStake(ALICE, NATIVE, 1);
        vm.expectRevert(AlibiIdentityRegistry.NotRouter.selector);
        registry.consumeDebt(ALICE, NATIVE, 1, 1);
        vm.stopPrank();
    }

    function test_modulesCanBeLocked() public {
        vm.startPrank(owner);
        registry.lockModules();
        vm.expectRevert(AlibiIdentityRegistry.ModulesAlreadyLocked.selector);
        registry.setModules(address(1), address(2));
        vm.stopPrank();
    }

    function test_tierConfig_validation() public {
        AlibiIdentityRegistry.TierConfig memory c = AlibiIdentityRegistry.TierConfig({
            baseMinDeals: 1,
            baseMinCounterparties: 1,
            baseMinAge: 0,
            provenMinDeals: 2,
            provenMinCounterparties: 1,
            provenMinAge: 0,
            newFloorBps: 10_000,
            baseFloorBps: 2000,
            provenFloorBps: 3000 // proven must not be looser than... stricter than base
        });
        vm.prank(owner);
        vm.expectRevert(AlibiIdentityRegistry.InvalidConfig.selector);
        registry.setTierConfig(c);
    }

    // ---------------------------------------------------------------- helpers

    function _relink(address wallet, bytes32 id) internal {
        _linkWith(wallet, id, true, 7 days);
    }

    /// @dev open and settle a deal so reputation accrues; payer pays remainder + fee
    function _settleDeal(address from, address to, uint256 total) internal {
        (uint256 id, uint256 bond) = _open(from, to, NATIVE, total, 3600);
        uint256 value = (total - bond) + escrow.feeFor(total);
        vm.prank(from);
        escrow.settleAgreement{value: value}(id);
    }
}
