// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Fixture} from "./Fixture.sol";
import {AlibiCreditEscrow} from "../src/AlibiCreditEscrow.sol";

/// Bust-out defenses: a protocol-wide unsecured limit, creditor-set rules, and an emergency stop for new agreements.
contract HardeningTest is Fixture {
    // ------------------------------------------------------------------ global unsecured limit

    function test_globalCap_unsetMeansNoUnsecuredCredit() public {
        vm.prank(owner);
        registry.setGlobalUnsecuredCap(NATIVE, 0);
        _link(alice1, ALICE);
        _seedProven(ALICE);
        (uint256 bond,) = escrow.quote(alice1, NATIVE, 500 ether);
        assertEq(bond, 500 ether, "even a Proven identity must post 100% when the protocol has no room");
    }

    function test_globalCap_limitsRoom_andIsFreedOnSettle() public {
        vm.prank(owner);
        registry.setGlobalUnsecuredCap(NATIVE, 60 ether);
        _link(alice1, ALICE);
        _link(bob1, BOB);
        _seedProven(ALICE);
        _seedProven(BOB);

        (uint256 id, uint256 bond) = _open(alice1, merchant, NATIVE, 500 ether, 3600);
        assertEq(bond, 440 ether, "only 60 of unsecured room existed");
        assertEq(registry.globalUnsecuredExposure(NATIVE), 60 ether);

        (uint256 bobBond,) = escrow.quote(bob1, NATIVE, 500 ether);
        assertEq(bobBond, 500 ether, "the protocol limit is used up, so Bob posts everything");

        uint256 fee = escrow.feeFor(500 ether);
        vm.prank(alice1);
        escrow.settleAgreement{value: 60 ether + fee}(id);
        assertEq(registry.globalUnsecuredExposure(NATIVE), 0);
        (bobBond,) = escrow.quote(bob1, NATIVE, 500 ether);
        assertEq(bobBond, 440 ether, "the 60 of protocol room is back after the settlement, and no more");
    }

    function test_globalCap_exposureStaysUntilDebtIsPaid() public {
        _link(alice1, ALICE);
        _link(alice2, ALICE);
        _seedProven(ALICE);
        (uint256 id,) = _open(alice1, merchant, NATIVE, 500 ether, 3600);
        assertEq(registry.globalUnsecuredExposure(NATIVE), 450 ether);

        _defaultIt(id);
        assertEq(registry.debtOutstanding(ALICE, NATIVE), 450 ether);
        assertEq(registry.globalUnsecuredExposure(NATIVE), 450 ether, "an unpaid default still counts against the protocol limit");

        vm.prank(payer);
        router.routePayment{value: 1_000 ether}(alice2, NATIVE, 1_000 ether);
        assertEq(registry.globalUnsecuredExposure(NATIVE), 0, "collected debt frees the protocol limit");
    }

    function test_globalCap_onlyOwnerCanSet() public {
        vm.prank(alice1);
        vm.expectRevert();
        registry.setGlobalUnsecuredCap(NATIVE, 1);
    }

    // ------------------------------------------------------------------ creditor policy

    function test_creditorPolicy_raisesTheBond() public {
        _link(alice1, ALICE);
        _seedProven(ALICE);
        vm.prank(merchant);
        escrow.setCreditorPolicy(5_000, 0); // this merchant wants at least 50% up front

        (uint256 plain,) = escrow.quote(alice1, NATIVE, 500 ether);
        (uint256 forMerchant,) = escrow.quoteFor(alice1, merchant, NATIVE, 500 ether);
        assertEq(plain, 50 ether);
        assertEq(forMerchant, 250 ether);

        vm.prank(alice1);
        (uint256 id, uint256 bond) = escrow.createAgreement{value: forMerchant}(merchant, NATIVE, 500 ether, 3600);
        assertEq(bond, 250 ether);
        assertEq(escrow.getAgreement(id).bond, 250 ether);
        assertEq(registry.exposure(ALICE, NATIVE), 250 ether, "only the unsecured remainder is exposure");

        // other creditors are unaffected
        (uint256 other,) = escrow.quoteFor(alice1, merchant2, NATIVE, 500 ether);
        assertEq(other, 50 ether);
    }

    function test_creditorPolicy_minTierBlocksLowerTiers() public {
        _link(alice1, ALICE);
        _seedProven(ALICE);
        _link(bob1, BOB); // verified but no history: tier New
        vm.prank(merchant);
        escrow.setCreditorPolicy(0, 3); // Proven only

        escrow.quoteFor(alice1, merchant, NATIVE, 100 ether); // fine

        vm.expectRevert(AlibiCreditEscrow.BelowCreditorPolicy.selector);
        escrow.quoteFor(bob1, merchant, NATIVE, 100 ether);

        vm.prank(bob1);
        vm.expectRevert(AlibiCreditEscrow.BelowCreditorPolicy.selector);
        escrow.createAgreement{value: 100 ether}(merchant, NATIVE, 100 ether, 3600);

        // an anonymous wallet cannot get around it by posting 100%
        vm.prank(payer);
        vm.expectRevert(AlibiCreditEscrow.BelowCreditorPolicy.selector);
        escrow.createAgreement{value: 100 ether}(merchant, NATIVE, 100 ether, 3600);
    }

    function test_creditorPolicy_validatesInput_andCanBeCleared() public {
        vm.startPrank(merchant);
        vm.expectRevert(AlibiCreditEscrow.InvalidPolicy.selector);
        escrow.setCreditorPolicy(10_001, 0);
        vm.expectRevert(AlibiCreditEscrow.InvalidPolicy.selector);
        escrow.setCreditorPolicy(0, 4);
        escrow.setCreditorPolicy(5_000, 3);
        escrow.setCreditorPolicy(0, 0);
        vm.stopPrank();
        (uint16 bps, uint8 tier) = escrow.creditorPolicy(merchant);
        assertEq(bps, 0);
        assertEq(tier, 0);
    }

    function testFuzz_creditorPolicy_bondNeverBelowPolicy(uint16 bps, uint96 total) public {
        bps = uint16(bound(bps, 0, 10_000));
        uint256 t = bound(total, 1 ether, 10_000 ether);
        _link(alice1, ALICE);
        _seedProven(ALICE);
        vm.prank(merchant);
        escrow.setCreditorPolicy(bps, 0);
        (uint256 bond,) = escrow.quoteFor(alice1, merchant, NATIVE, t);
        assertGe(bond * 10_000, t * bps, "bond covers the creditor's minimum share");
        assertLe(bond, t, "never more than the total");
    }

    // ------------------------------------------------------------------ emergency pause

    function test_pause_blocksNewAgreementsOnly() public {
        _link(alice1, ALICE);
        _seedProven(ALICE);
        (uint256 openId,) = _open(alice1, merchant, NATIVE, 500 ether, 3600);
        (uint256 lateId,) = _open(alice1, merchant, NATIVE, 100 ether, 15);

        vm.prank(owner);
        escrow.pause();

        vm.prank(alice1);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        escrow.createAgreement{value: 10 ether}(merchant, NATIVE, 100 ether, 3600);

        // existing agreements can still be settled...
        uint256 fee = escrow.feeFor(500 ether);
        vm.prank(alice1);
        escrow.settleAgreement{value: 450 ether + fee}(openId);
        // ...and defaulted
        _defaultIt(lateId);
        assertTrue(registry.hasActiveDebt(ALICE));

        vm.prank(owner);
        escrow.unpause();
        _link(bob1, BOB);
        vm.prank(bob1);
        escrow.createAgreement{value: 10 ether}(merchant, NATIVE, 10 ether, 3600);
    }

    function test_pause_onlyOwner() public {
        vm.prank(alice1);
        vm.expectRevert();
        escrow.pause();
        vm.prank(owner);
        escrow.pause();
        vm.prank(alice1);
        vm.expectRevert();
        escrow.unpause();
    }
}
