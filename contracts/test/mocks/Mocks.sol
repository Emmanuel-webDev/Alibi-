// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AssetTransferLib} from "../../src/libraries/AssetTransferLib.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock QUSDC", "mQUSDC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev A creditor that refuses native QIE: proves a hostile recipient cannot block anyone else.
contract RejectingReceiver {
    receive() external payable {
        revert("no thanks");
    }
}

/// @dev Exposes the library's internal functions so they can be tested directly.
contract AssetTransferHarness {
    function pullIn(address asset, address from, uint256 amount) external payable {
        AssetTransferLib.pull(asset, from, amount);
    }

    function pushOut(address asset, address to, uint256 amount) external {
        AssetTransferLib.push(asset, to, amount);
    }

    function tryPushOut(address asset, address to, uint256 amount) external returns (bool) {
        return AssetTransferLib.tryPush(asset, to, amount);
    }
}
