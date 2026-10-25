// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Fixture} from "./Fixture.sol";
import {AlibiGatedVault} from "../src/AlibiGatedVault.sol";
import {AlibiGuard} from "../src/AlibiGuard.sol";
import {IAlibiRegistry} from "../src/interfaces/IAlibiRegistry.sol";

/// @dev The exact Judge Sandbox story, plus the DeFi choke-point integration.
contract DemoScenarioTest is Fixture {
    AlibiGatedVault vault;

    function setUp() public override {
        super.setUp();
        vault = new AlibiGatedVault(owner, registry, router, 10 ether);
        vm.deal(owner, 1_000 ether);
        vm.prank(owner);
        vault.fundGrants{value: 100 ether}();
    }

    /// 500 QIE deal, 10% bond (proven demo identity) -> 15s -> default -> 450 debt ->
    /// Wallet B receives 1,000 QIE through the router -> 450 garnished, 550 lands, identity solvent.
    function test_judgeSandbox_endToEnd() public {
        // Step 1: bind Wallet A and Wallet B to the same QIE identity (demo identity is pre-seeded)
        _link(alice1, ALICE);
        _seedProven(ALICE);
        (uint256 id, uint256 bond) = _open(alice1, merchant, NATIVE, 500 ether, 15);
        assertEq(bond, 50 ether, "locked only 50 of 500: 90% working capital saved");

        // Step 2: the 15 seconds elapse for real; anyone triggers the default through production code
        _defaultIt(id);
        assertEq(registry.debtOutstanding(ALICE, NATIVE), 450 ether);
        (, bool activeDebt,,,) = registry.getWalletSolvency(alice1);
        assertTrue(activeDebt);

        // Step 3: Alice abandons Wallet A and brings up a brand-new Wallet B on the same identity
        _link(alice2, ALICE);
        (, activeDebt,,,) = registry.getWalletSolvency(alice2);
        assertTrue(activeDebt, "the debt followed her to the new wallet");

        uint256 merchantBefore = merchant.balance;
        uint256 walletBBefore = alice2.balance;
        vm.prank(payer);
        router.routePayment{value: 1_000 ether}(alice2, NATIVE, 1_000 ether);

        assertEq(merchant.balance - merchantBefore, 450 ether, "creditor garnished 450");
        assertEq(alice2.balance - walletBBefore, 550 ether, "550 lands in Wallet B");
        (, activeDebt,,,) = registry.getWalletSolvency(alice2);
        assertFalse(activeDebt, "identity restored to solvent");
        // she is solvent again but NOT proven again: one default permanently drops the earned tier
        assertEq(uint8(registry.tierOf(ALICE)), uint8(IAlibiRegistry.Tier.New));
    }

    function test_burnAndRejoinWithFreshIdentity_getsNoCredit() public {
        // the $5 re-registration attack: a fresh verified identity gets 100% bond, nothing to steal
        _link(dave1, DAVE);
        (uint256 id, uint256 bond) = _open(dave1, merchant, NATIVE, 500 ether, 15);
        assertEq(bond, 500 ether);
        uint256 spent = bond;
        _defaultIt(id);
        // dave "stole" nothing: the creditor received the entire bond (less the 0.5% keeper bounty)
        assertEq(registry.debtOutstanding(DAVE, NATIVE), 0);
        assertEq(spent - (merchant.balance - 1 ether) - keeper.balance, 0);
    }

    // ---------------------------------------------------------------- AlibiGuard / vault choke points

    function test_vaultWithdraw_garnishesDefaulterAtomically() public {
        _link(alice1, ALICE);
        _seedProven(ALICE);
        (uint256 id,) = _open(alice1, merchant, NATIVE, 500 ether, 15);
        _defaultIt(id);

        vm.prank(alice1);
        vault.deposit{value: 1_000 ether}();
        uint256 m0 = merchant.balance;
        uint256 a0 = alice1.balance;
        vm.prank(alice1);
        vault.withdraw(1_000 ether);
        assertEq(merchant.balance - m0, 450 ether);
        assertEq(alice1.balance - a0, 550 ether);
        assertFalse(registry.hasActiveDebt(ALICE));
    }

    function test_grant_oncePerIdentity_notPerWallet() public {
        _link(bob1, BOB);
        _link(carol1, BOB);
        uint256 b0 = bob1.balance;
        vm.prank(bob1);
        vault.claimGrant();
        assertEq(bob1.balance - b0, 10 ether);

        vm.prank(carol1); // second wallet of the same identity: a Sybil farm gets one grant, not many
        vm.expectRevert(AlibiGatedVault.GrantAlreadyClaimed.selector);
        vault.claimGrant();
    }

    function test_grant_blockedForDefaulters() public {
        _link(alice1, ALICE);
        _seedProven(ALICE);
        (uint256 id,) = _open(alice1, merchant, NATIVE, 500 ether, 15);
        _defaultIt(id);
        vm.prank(alice1);
        vm.expectRevert(abi.encodeWithSelector(AlibiGuard.AlibiActiveDefault.selector, alice1, ALICE));
        vault.claimGrant();
    }

    function test_grant_requiresVerifiedIdentity() public {
        vm.prank(payer); // unlinked
        vm.expectRevert(abi.encodeWithSelector(AlibiGuard.AlibiNotVerified.selector, payer));
        vault.claimGrant();
    }

    function test_grant_cannotDrainUserDeposits() public {
        _link(bob1, BOB);
        vm.prank(carol1);
        vault.deposit{value: 95 ether}();
        // pool balance = 100 funded + 95 deposits; grants must not eat into deposits
        vm.prank(owner);
        vault.setGrantAmount(150 ether);
        vm.prank(bob1);
        vm.expectRevert(AlibiGatedVault.GrantPoolEmpty.selector);
        vault.claimGrant();
    }

    function test_vault_rejectsPlainTransfers() public {
        vm.prank(alice1);
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertFalse(ok);
    }
}
