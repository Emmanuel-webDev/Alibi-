// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAlibiRegistry} from "./interfaces/IAlibiRegistry.sol";
import {AlibiGuard} from "./AlibiGuard.sol";
import {AlibiSlashingRouter} from "./AlibiSlashingRouter.sol";

/// @title AlibiGatedVault
/// @notice Reference integration showing the two choke points an ecosystem protocol gets from Alibi.
///   1. `withdraw`   pays out THROUGH the router, so a defaulter's withdrawal is garnished atomically
///                   ("Settle & Execute"): their debt is repaid and they are unblocked in the same tx.
///   2. `claimGrant` is one-per-verified-identity (not per wallet) and refuses defaulters, so neither
///                   a Sybil farm of wallets nor a person in default can drain the incentive pool.
contract AlibiGatedVault is AlibiGuard, Ownable2Step, ReentrancyGuard {
    AlibiSlashingRouter public immutable router;
    uint256 public grantAmount;

    mapping(address => uint256) public balanceOf;
    mapping(bytes32 => bool) public grantClaimed; // per identity, not per wallet
    uint256 public totalDeposits;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount, uint256 garnished);
    event GrantClaimed(bytes32 indexed identityId, address indexed wallet, uint256 amount);
    event GrantFunded(uint256 amount);
    event GrantAmountSet(uint256 amount);

    error InsufficientBalance();
    error GrantAlreadyClaimed();
    error GrantPoolEmpty();
    error ZeroAmount();
    error TransferFailed();

    constructor(address owner_, IAlibiRegistry registry_, AlibiSlashingRouter router_, uint256 grantAmount_)
        AlibiGuard(registry_)
        Ownable(owner_)
    {
        router = router_;
        grantAmount = grantAmount_;
    }

    receive() external payable {
        revert("use fundGrants()");
    }

    function fundGrants() external payable onlyOwner {
        emit GrantFunded(msg.value);
    }

    function setGrantAmount(uint256 amount) external onlyOwner {
        grantAmount = amount;
        emit GrantAmountSet(amount);
    }

    function deposit() external payable {
        if (msg.value == 0) revert ZeroAmount();
        balanceOf[msg.sender] += msg.value;
        totalDeposits += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Withdraw through the Alibi router: any open debt on your identity is paid first.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (balanceOf[msg.sender] < amount) revert InsufficientBalance();
        balanceOf[msg.sender] -= amount;
        totalDeposits -= amount;
        uint256 garnished = router.routePayment{value: amount}(msg.sender, address(0), amount);
        emit Withdrawn(msg.sender, amount, garnished);
    }

    /// @notice One grant per verified identity; blocked while the identity has an unpaid default.
    function claimGrant() external nonReentrant onlyVerifiedSolventQIE(msg.sender) {
        bytes32 id = alibiRegistry.identityOf(msg.sender);
        if (grantClaimed[id]) revert GrantAlreadyClaimed();
        uint256 amount = grantAmount;
        // never pay grants out of user deposits
        if (address(this).balance < totalDeposits + amount) revert GrantPoolEmpty();
        grantClaimed[id] = true;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit GrantClaimed(id, msg.sender, amount);
    }
}
