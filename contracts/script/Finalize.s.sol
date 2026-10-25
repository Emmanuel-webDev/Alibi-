// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AlibiIdentityRegistry} from "../src/AlibiIdentityRegistry.sol";
import {AlibiCreditEscrow} from "../src/AlibiCreditEscrow.sol";
import {Eip712AttestationVerifier} from "../src/Eip712AttestationVerifier.sol";
import {AlibiGatedVault} from "../src/AlibiGatedVault.sol";

/// @notice Mainnet hardening, run once after the live demo identity has been seeded:
///           1. permanently disable reputation seeding,
///           2. freeze the escrow/router addresses in the registry,
///           3. start a two-step ownership transfer of every owned contract to a multisig (NEW_OWNER),
///              who must then call acceptOwnership() on each.
///
/// Env: DEPLOYER_PRIVATE_KEY, REGISTRY, ESCROW, VERIFIER, VAULT, NEW_OWNER
contract Finalize is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address newOwner = vm.envAddress("NEW_OWNER");
        AlibiIdentityRegistry registry = AlibiIdentityRegistry(vm.envAddress("REGISTRY"));
        AlibiCreditEscrow escrow = AlibiCreditEscrow(payable(vm.envAddress("ESCROW")));
        Eip712AttestationVerifier verifier = Eip712AttestationVerifier(vm.envAddress("VERIFIER"));
        AlibiGatedVault vault = AlibiGatedVault(payable(vm.envAddress("VAULT")));

        vm.startBroadcast(pk);
        registry.disableSeeding();
        registry.lockModules();
        registry.transferOwnership(newOwner);
        escrow.transferOwnership(newOwner);
        verifier.transferOwnership(newOwner);
        vault.transferOwnership(newOwner);
        vm.stopBroadcast();

        console2.log("seeding disabled, modules locked, ownership transfer started to", newOwner);
        console2.log("NEW_OWNER must now call acceptOwnership() on registry, escrow, verifier, vault");
    }
}
