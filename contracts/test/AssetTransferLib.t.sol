// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AssetTransferLib} from "../src/libraries/AssetTransferLib.sol";
import {MockERC20, RejectingReceiver, AssetTransferHarness} from "./mocks/Mocks.sol";

contract AssetTransferLibTest is Test {
    AssetTransferHarness h;
    MockERC20 token;
    address user = makeAddr("user");

    function setUp() public {
        h = new AssetTransferHarness();
        token = new MockERC20();
        vm.deal(user, 100 ether);
        token.mint(user, 100 ether);
        vm.prank(user);
        token.approve(address(h), type(uint256).max);
    }

    function test_nativePull_exactValueOk() public {
        vm.prank(user);
        h.pullIn{value: 5 ether}(address(0), user, 5 ether);
        assertEq(address(h).balance, 5 ether);
    }

    function test_nativePull_wrongValueReverts() public {
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(AssetTransferLib.NativeValueMismatch.selector, 4 ether, 5 ether));
        h.pullIn{value: 4 ether}(address(0), user, 5 ether);

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(AssetTransferLib.NativeValueMismatch.selector, 6 ether, 5 ether));
        h.pullIn{value: 6 ether}(address(0), user, 5 ether);
    }

    function test_erc20Pull_movesTokens() public {
        vm.prank(user);
        h.pullIn(address(token), user, 7 ether);
        assertEq(token.balanceOf(address(h)), 7 ether);
    }

    function test_erc20Pull_rejectsNativeValue_soNothingGetsTrapped() public {
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(AssetTransferLib.UnexpectedNativeValue.selector, 1 ether));
        h.pullIn{value: 1 ether}(address(token), user, 7 ether);
        assertEq(address(h).balance, 0);
    }

    function test_push_nativeAndErc20() public {
        vm.deal(address(h), 3 ether);
        token.mint(address(h), 3 ether);
        address to = makeAddr("to");
        h.pushOut(address(0), to, 3 ether);
        h.pushOut(address(token), to, 3 ether);
        assertEq(to.balance, 3 ether);
        assertEq(token.balanceOf(to), 3 ether);
    }

    function test_push_revertsOnRejectingReceiver_butTryPushReturnsFalse() public {
        RejectingReceiver r = new RejectingReceiver();
        vm.deal(address(h), 2 ether);
        vm.expectRevert(AssetTransferLib.NativeTransferFailed.selector);
        h.pushOut(address(0), address(r), 1 ether);
        assertFalse(h.tryPushOut(address(0), address(r), 1 ether));
        assertEq(address(h).balance, 2 ether);
    }

    function test_zeroAmountIsNoop() public {
        h.pushOut(address(0), address(0xdead), 0);
        assertTrue(h.tryPushOut(address(0), address(0xdead), 0));
    }
}
