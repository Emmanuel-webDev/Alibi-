// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Fixture} from "./Fixture.sol";
import {AlibiSlashingRouter} from "../src/AlibiSlashingRouter.sol";
import {AssetTransferLib} from "../src/libraries/AssetTransferLib.sol";
import {RejectingReceiver} from "./mocks/Mocks.sol";

contract SlashingRouterTest is Fixture {
    function setUp() public override {
        super.setUp();
        _link(alice1, ALICE);
        _link(alice2, ALICE);
        _seedProven(ALICE);
    }

    function _routeNative(address from, address to, uint256 amount) internal returns (uint256 garnished) {
        vm.prank(from);
        garnished = router.routePayment{value: amount}(to, NATIVE, amount);
    }

    // ------------------------------------------------------------------ pass-through

    function test_unlinkedRecipient_receivesEverything() public {
        address stranger = makeAddr("stranger");
        _routeNative(payer, stranger, 10 ether);
        assertEq(stranger.balance, 10 ether);
    }

    function test_solventLinkedRecipient_receivesEverything() public {
        uint256 before = alice2.balance;
        uint256 g = _routeNative(payer, alice2, 10 ether);
        assertEq(g, 0);
        assertEq(alice2.balance - before, 10 ether);
    }

    // ------------------------------------------------------------------ garnishment

    function _makeDebt(uint256 total) internal returns (uint256 id) {
        (id,) = _open(alice1, merchant, NATIVE, total, 15);
        _defaultIt(id);
    }

    function test_partialGarnishment_forwardsNothing_debtShrinks() public {
        _makeDebt(500 ether); // 450 debt
        uint256 m0 = merchant.balance;
        uint256 b0 = alice2.balance;
        uint256 g = _routeNative(payer, alice2, 100 ether);
        assertEq(g, 100 ether);
        assertEq(merchant.balance - m0, 100 ether);
        assertEq(alice2.balance, b0);
        assertEq(registry.debtOutstanding(ALICE, NATIVE), 350 ether);
        assertTrue(registry.hasActiveDebt(ALICE));
    }

    function test_fullGarnishment_cleansIdentity_andForwardsRemainder() public {
        _makeDebt(500 ether);
        uint256 m0 = merchant.balance;
        uint256 b0 = alice2.balance;
        uint256 g = _routeNative(payer, alice2, 1_000 ether);
        assertEq(g, 450 ether);
        assertEq(merchant.balance - m0, 450 ether);
        assertEq(alice2.balance - b0, 550 ether);
        assertFalse(registry.hasActiveDebt(ALICE));
        assertEq(registry.exposure(ALICE, NATIVE), 0);
        assertEq(address(router).balance, 0, "router never retains funds");
    }

    function test_garnishmentWorksFromEitherWallet_ofTheSameIdentity() public {
        _makeDebt(500 ether);
        // defaulted on alice1, paid via alice1 as well: same identity state
        uint256 g = _routeNative(payer, alice1, 50 ether);
        assertEq(g, 50 ether);
        assertEq(registry.debtOutstanding(ALICE, NATIVE), 400 ether);
    }

    function test_fifo_oldestCreditorPaidFirst() public {
        (uint256 id1,) = _open(alice1, merchant, NATIVE, 200 ether, 15); // 180 debt
        vm.warp(block.timestamp + 1);
        (uint256 id2,) = _open(alice1, merchant2, NATIVE, 300 ether, 600); // 270 debt, later deadline
        // default the first only, then the second
        vm.warp(escrowDeadline(id1) + 1);
        escrow.triggerDefault(id1);
        vm.warp(escrowDeadline(id2) + 1);
        escrow.triggerDefault(id2);

        uint256 m1 = merchant.balance;
        uint256 m2 = merchant2.balance;
        _routeNative(payer, alice2, 300 ether);
        assertEq(merchant.balance - m1, 180 ether, "creditor 1 made whole first");
        assertEq(merchant2.balance - m2, 120 ether, "leftover cascades to creditor 2");
        assertEq(registry.debtOutstanding(ALICE, NATIVE), 150 ether);
        assertEq(registry.openClaimCount(ALICE), 1);

        _routeNative(payer, alice2, 150 ether);
        assertEq(merchant2.balance - m2, 270 ether);
        assertFalse(registry.hasActiveDebt(ALICE));
    }

    function test_maxClaimsCapBoundsGas_remainderGoesThroughAndNextPaymentContinues() public {
        // 4 claims, router handles 3 per payment
        address[4] memory cs = [makeAddr("c1"), makeAddr("c2"), makeAddr("c3"), makeAddr("c4")];
        uint256[4] memory ids;
        for (uint256 k = 0; k < 4; k++) {
            (ids[k],) = _open(alice1, cs[k], NATIVE, 100 ether, 15 + uint64(k));
        }
        vm.warp(escrowDeadline(ids[3]) + 1);
        for (uint256 k = 0; k < 4; k++) {
            escrow.triggerDefault(ids[k]);
        }
        assertEq(registry.openClaimCount(ALICE), 4); // 4 x 90

        uint256 b0 = alice2.balance;
        uint256 g = _routeNative(payer, alice2, 1_000 ether);
        assertEq(g, 270 ether, "only 3 claims processed");
        assertEq(alice2.balance - b0, 730 ether);
        assertEq(registry.openClaimCount(ALICE), 1);

        g = _routeNative(payer, alice2, 1_000 ether);
        assertEq(g, 90 ether);
        assertFalse(registry.hasActiveDebt(ALICE));
        assertEq(cs[3].balance, 90 ether + 9.95 ether); // debt + bond share
    }

    function test_assetSeparation_usdcPaymentDoesNotTouchNativeClaims() public {
        _makeDebt(500 ether); // native claim of 450
        vm.startPrank(payer);
        usdc.approve(address(router), type(uint256).max);
        uint256 g = router.routePayment(alice2, address(usdc), 100 ether);
        vm.stopPrank();
        assertEq(g, 0, "no USDC claims exist, so nothing is garnished");
        assertEq(usdc.balanceOf(alice2), 100 ether);
        assertEq(registry.debtOutstanding(ALICE, NATIVE), 450 ether);
    }

    function test_erc20Garnishment() public {
        vm.prank(alice1);
        usdc.approve(address(escrow), type(uint256).max);
        (uint256 id,) = _open(alice1, merchant, address(usdc), 500 ether, 15);
        _defaultIt(id);
        assertEq(registry.debtOutstanding(ALICE, address(usdc)), 450 ether);

        vm.startPrank(payer);
        usdc.approve(address(router), type(uint256).max);
        uint256 g = router.routePayment(alice2, address(usdc), 1_000 ether);
        vm.stopPrank();
        assertEq(g, 450 ether);
        assertEq(usdc.balanceOf(alice2), 550 ether);
        assertEq(usdc.balanceOf(merchant), 450 ether + 49.75 ether);
    }

    function test_rejectingCreditor_cannotBlockGarnishment() public {
        RejectingReceiver bad = new RejectingReceiver();
        (uint256 id,) = _open(alice1, address(bad), NATIVE, 500 ether, 15);
        _defaultIt(id);
        uint256 b0 = alice2.balance;
        uint256 g = _routeNative(payer, alice2, 1_000 ether);
        assertEq(g, 450 ether);
        assertEq(alice2.balance - b0, 550 ether, "recipient still paid the remainder");
        assertEq(router.claimable(address(bad), NATIVE), 450 ether, "creditor can withdraw later");
    }

    // ------------------------------------------------------------------ input validation

    function test_routePayment_validations() public {
        vm.startPrank(payer);
        vm.expectRevert(AlibiSlashingRouter.ZeroAmount.selector);
        router.routePayment(alice2, NATIVE, 0);
        vm.expectRevert(AlibiSlashingRouter.ZeroAddress.selector);
        router.routePayment{value: 1 ether}(address(0), NATIVE, 1 ether);
        vm.expectRevert(abi.encodeWithSelector(AssetTransferLib.NativeValueMismatch.selector, 1 ether, 2 ether));
        router.routePayment{value: 1 ether}(alice2, NATIVE, 2 ether);
        vm.expectRevert(abi.encodeWithSelector(AssetTransferLib.UnexpectedNativeValue.selector, 1 ether));
        router.routePayment{value: 1 ether}(alice2, address(usdc), 2 ether);
        vm.stopPrank();
    }

    function test_previewSplit_matchesActualRouting() public {
        _makeDebt(500 ether);
        (uint256 g, uint256 net, uint256 claims) = router.previewSplit(alice2, NATIVE, 1_000 ether);
        assertEq(g, 450 ether);
        assertEq(net, 550 ether);
        assertEq(claims, 1);
        (g, net,) = router.previewSplit(alice2, NATIVE, 100 ether);
        assertEq(g, 100 ether);
        assertEq(net, 0);
    }

    // ------------------------------------------------------------------ invariants via fuzzing

    /// @dev money in == money out, no matter the debt size or payment size.
    function testFuzz_conservation(uint256 totalSeed, uint256 paySeed) public {
        uint256 total = bound(totalSeed, 10 ether, 2_000 ether);
        uint256 pay = bound(paySeed, 1, 5_000 ether);
        (uint256 id, uint256 bond) = _open(alice1, merchant, NATIVE, total, 15);
        _defaultIt(id);
        uint256 debt = total - bond;

        uint256 m0 = merchant.balance;
        uint256 a0 = alice2.balance;
        uint256 r0 = address(router).balance;
        uint256 g = _routeNative(payer, alice2, pay);

        assertEq(g, pay < debt ? pay : debt, "garnished = min(pay, debt)");
        assertEq((merchant.balance - m0) + (alice2.balance - a0), pay, "every wei accounted for");
        assertEq(address(router).balance, r0, "router balance unchanged");
        assertEq(registry.debtOutstanding(ALICE, NATIVE), debt - g);
        assertEq(registry.exposure(ALICE, NATIVE), debt - g, "exposure tracks outstanding debt");
    }

    function escrowDeadline(uint256 id) internal view returns (uint64) {
        return escrow.getAgreement(id).deadline;
    }
}
