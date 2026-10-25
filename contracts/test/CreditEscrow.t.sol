// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Fixture} from "./Fixture.sol";
import {AlibiCreditEscrow} from "../src/AlibiCreditEscrow.sol";
import {AssetTransferLib} from "../src/libraries/AssetTransferLib.sol";
import {RejectingReceiver} from "./mocks/Mocks.sol";

contract CreditEscrowTest is Fixture {
    function test_unlinkedPayer_posts100Percent_andForfeitsBondOnDefault() public {
        (uint256 id, uint256 bond) = _open(payer, merchant, NATIVE, 100 ether, 15);
        assertEq(bond, 100 ether);
        uint256 before = merchant.balance;
        _defaultIt(id);
        // creditor gets the whole bond minus the 0.5% keeper bounty; no debt exists for an anonymous wallet
        assertEq(merchant.balance - before, 99.5 ether);
        assertEq(keeper.balance, 0.5 ether);
    }

    function test_settle_paysCreditorTotal_andFeeToTreasury() public {
        _link(alice1, ALICE);
        _seedProven(ALICE);
        (uint256 id, uint256 bond) = _open(alice1, merchant, NATIVE, 500 ether, 3600);
        assertEq(bond, 50 ether);
        uint256 m0 = merchant.balance;

        uint256 fee = escrow.feeFor(500 ether); // 0.5% = 2.5
        vm.prank(alice1);
        escrow.settleAgreement{value: 450 ether + fee}(id);

        assertEq(merchant.balance - m0, 500 ether, "creditor receives the full total");
        assertEq(treasury.balance, fee);
        assertEq(registry.exposure(ALICE, NATIVE), 0, "exposure released");
        assertFalse(registry.hasActiveDebt(ALICE));
    }

    function test_settle_wrongValueReverts() public {
        _link(alice1, ALICE);
        _seedProven(ALICE);
        (uint256 id,) = _open(alice1, merchant, NATIVE, 500 ether, 3600);
        vm.prank(alice1);
        vm.expectRevert();
        escrow.settleAgreement{value: 1 ether}(id);
    }

    function test_settle_afterDeadlineReverts_andOnlyPayerCanSettle() public {
        _link(alice1, ALICE);
        _seedProven(ALICE);
        (uint256 id,) = _open(alice1, merchant, NATIVE, 500 ether, 60);

        vm.prank(bob1);
        vm.expectRevert(AlibiCreditEscrow.NotPayer.selector);
        escrow.settleAgreement{value: 452.5 ether}(id);

        vm.warp(block.timestamp + 61);
        vm.prank(alice1);
        vm.expectRevert(AlibiCreditEscrow.DeadlinePassed.selector);
        escrow.settleAgreement{value: 452.5 ether}(id);
    }

    function test_triggerDefault_beforeDeadlineReverts() public {
        (uint256 id,) = _open(payer, merchant, NATIVE, 10 ether, 3600);
        vm.expectRevert(AlibiCreditEscrow.DeadlineNotReached.selector);
        escrow.triggerDefault(id);
    }

    function test_triggerDefault_isPermissionless_paysKeeper_recordsDebt() public {
        _link(alice1, ALICE);
        _seedProven(ALICE);
        (uint256 id,) = _open(alice1, merchant, NATIVE, 500 ether, 15);
        uint256 m0 = merchant.balance;
        _defaultIt(id);

        assertEq(keeper.balance, 0.25 ether, "0.5% of the 50 bond");
        assertEq(merchant.balance - m0, 49.75 ether);
        assertEq(registry.debtOutstanding(ALICE, NATIVE), 450 ether);
        assertTrue(registry.hasActiveDebt(ALICE));
    }

    function test_triggerDefault_twiceReverts() public {
        (uint256 id,) = _open(payer, merchant, NATIVE, 10 ether, 15);
        _defaultIt(id);
        vm.expectRevert(AlibiCreditEscrow.NotOpen.selector);
        escrow.triggerDefault(id);
    }

    function test_settledAgreement_cannotBeDefaulted() public {
        _link(alice1, ALICE);
        _seedProven(ALICE);
        (uint256 id,) = _open(alice1, merchant, NATIVE, 100 ether, 15);
        uint256 settleValue = 90 ether + escrow.feeFor(100 ether);
        vm.prank(alice1);
        escrow.settleAgreement{value: settleValue}(id);
        vm.warp(block.timestamp + 100);
        vm.expectRevert(AlibiCreditEscrow.NotOpen.selector);
        escrow.triggerDefault(id);
    }

    function test_defaulter_cannotOpenNewAgreements_fromAnyLinkedWallet() public {
        _link(alice1, ALICE);
        _link(alice2, ALICE);
        _seedProven(ALICE);
        (uint256 id,) = _open(alice1, merchant, NATIVE, 500 ether, 15);
        _defaultIt(id);

        // wallet B of the same identity is blocked too
        vm.prank(alice2);
        vm.expectRevert(AlibiCreditEscrow.ActiveDefault.selector);
        escrow.createAgreement{value: 100 ether}(merchant, NATIVE, 100 ether, 60);
    }

    function test_createAgreement_validations() public {
        vm.startPrank(payer);
        vm.expectRevert(AlibiCreditEscrow.InvalidDuration.selector);
        escrow.createAgreement{value: 1 ether}(merchant, NATIVE, 1 ether, 14); // below the minimum
        vm.expectRevert(AlibiCreditEscrow.InvalidDuration.selector);
        escrow.createAgreement{value: 1 ether}(merchant, NATIVE, 1 ether, 366 days);
        vm.expectRevert(AlibiCreditEscrow.InvalidParty.selector);
        escrow.createAgreement{value: 1 ether}(payer, NATIVE, 1 ether, 60);
        vm.expectRevert(AlibiCreditEscrow.InvalidParty.selector);
        escrow.createAgreement{value: 1 ether}(address(0), NATIVE, 1 ether, 60);
        vm.expectRevert(AlibiCreditEscrow.InvalidAmount.selector);
        escrow.createAgreement(merchant, NATIVE, 0, 60);
        vm.stopPrank();
    }

    function test_createAgreement_bondMustMatchExactly() public {
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(AssetTransferLib.NativeValueMismatch.selector, 1 ether, 10 ether));
        escrow.createAgreement{value: 1 ether}(merchant, NATIVE, 10 ether, 60);
    }

    function test_capRaisesBondForOversizedDeal() public {
        _link(alice1, ALICE);
        vm.warp(block.timestamp + 8 days);
        // earn Base through the seeding helper path: 3 deals / 2 counterparties / 8+ days
        vm.prank(owner);
        registry.seedReputation(ALICE, 3, 2, uint64(block.timestamp - 8 days));
        _linkWith(alice1, ALICE, true, 7 days);
        // Base: floor 25%, cap 200. A 1000 deal wants 750 unsecured -> only 200 allowed -> bond 800
        (, uint256 bond) = _open(alice1, merchant, NATIVE, 1_000 ether, 60);
        assertEq(bond, 800 ether);
    }

    function test_exposureCap_acrossConcurrentAgreements() public {
        _link(alice1, ALICE);
        _seedProven(ALICE); // cap 2000
        _open(alice1, merchant, NATIVE, 1_000 ether, 3600); // unsecured 900
        _open(alice1, merchant, NATIVE, 1_000 ether, 3600); // unsecured 900 -> exposure 1800
        // third deal can only get 200 more unsecured: 1000 deal -> bond 800
        (, uint256 bond) = _open(alice1, merchant, NATIVE, 1_000 ether, 3600);
        assertEq(bond, 800 ether);
        assertEq(registry.exposure(ALICE, NATIVE), 2_000 ether);
    }

    function test_erc20Agreement_fullLifecycle() public {
        _link(alice1, ALICE);
        _seedProven(ALICE);
        vm.prank(alice1);
        usdc.approve(address(escrow), type(uint256).max);
        (uint256 id, uint256 bond) = _open(alice1, merchant, address(usdc), 500 ether, 3600);
        assertEq(bond, 50 ether);
        assertEq(usdc.balanceOf(address(escrow)), 50 ether);

        vm.prank(alice1);
        escrow.settleAgreement(id);
        assertEq(usdc.balanceOf(merchant), 500 ether);
        assertEq(usdc.balanceOf(treasury), escrow.feeFor(500 ether));
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_erc20Agreement_rejectsNativeValue() public {
        vm.prank(payer);
        usdc.approve(address(escrow), type(uint256).max);
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(AssetTransferLib.UnexpectedNativeValue.selector, 1 ether));
        escrow.createAgreement{value: 1 ether}(merchant, address(usdc), 10 ether, 60);
    }

    function test_rejectingCreditor_cannotBlockDefault_fundsAreCredited() public {
        RejectingReceiver bad = new RejectingReceiver();
        (uint256 id,) = _open(payer, address(bad), NATIVE, 10 ether, 15);
        _defaultIt(id); // must not revert
        assertEq(escrow.claimable(address(bad), NATIVE), 9.95 ether);
    }

    function test_escrowReceive_rejectsRandomSenders() public {
        vm.prank(alice1);
        (bool ok,) = address(escrow).call{value: 1 ether}("");
        assertFalse(ok);
    }

    function test_fee_isCapped() public {
        vm.prank(owner);
        vm.expectRevert(AlibiCreditEscrow.FeeTooHigh.selector);
        escrow.setFee(101, treasury);
    }

    function test_flashTerms_realAgreement15Seconds() public {
        // the Judge Sandbox path: no backdoor, just a 15 second real agreement
        _link(alice1, ALICE);
        _seedProven(ALICE);
        (uint256 id,) = _open(alice1, merchant, NATIVE, 500 ether, 15);
        vm.warp(block.timestamp + 14);
        vm.expectRevert(AlibiCreditEscrow.DeadlineNotReached.selector);
        escrow.triggerDefault(id);
        vm.warp(block.timestamp + 2);
        escrow.triggerDefault(id);
        assertEq(registry.debtOutstanding(ALICE, NATIVE), 450 ether);
    }
}
