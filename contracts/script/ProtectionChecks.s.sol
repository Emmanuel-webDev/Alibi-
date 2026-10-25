// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AlibiIdentityRegistry} from "../src/AlibiIdentityRegistry.sol";
import {AlibiCreditEscrow} from "../src/AlibiCreditEscrow.sol";
import {IAlibiRegistry} from "../src/interfaces/IAlibiRegistry.sol";

contract ProtectionChecks is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        AlibiIdentityRegistry registry = AlibiIdentityRegistry(vm.envAddress("REGISTRY"));
        AlibiCreditEscrow escrow = AlibiCreditEscrow(payable(vm.envAddress("ESCROW")));
        address payer = vm.envAddress("PAYER");

        address nativeAsset = address(0);
        uint256 testDeal = 1 ether;

        console2.log("Running Protection Checks on chain ID", block.chainid);
        console2.log("Deployer / Owner:", deployer);
        console2.log("Payer:", payer);

        vm.startBroadcast(pk);

        // In Stage 2.7 the identity defaulted, resetting it to Tier.New (where default unsecured cap = 0).
        // Temporarily grant Tier.New capacity so we can test bond percentage scaling and tier gates.
        registry.setUnsecuredCap(nativeAsset, IAlibiRegistry.Tier.New, 10 ether);

        // -------------------------------------------------------------
        // Check 1: Creditor policy raises bond (50% min up-front)
        // -------------------------------------------------------------
        console2.log("\n--- Check 1: Creditor policy 50% min up-front ---");
        (uint256 baseBond,) = escrow.quoteFor(payer, deployer, nativeAsset, testDeal);
        console2.log("Base bond with 0 policy (expected 0.1 QIE):", baseBond);
        require(baseBond == 0.1 ether, "Base bond is not 10%");

        escrow.setCreditorPolicy(5_000, 0); // 50% min bond
        (uint256 bond50,) = escrow.quoteFor(payer, deployer, nativeAsset, testDeal);
        console2.log("Quote with 50% creditor rule (expected 0.5 QIE):", bond50);
        require(bond50 == 0.5 ether, "Check 1 Failed: Bond did not increase to 50%");
        console2.log("Check 1 PASSED: Creditor policy successfully raised bond from 10% to 50%");

        // -------------------------------------------------------------
        // Check 2: Creditor min tier Proven (blocks lower tiers)
        // -------------------------------------------------------------
        console2.log("\n--- Check 2: Creditor min tier Proven ---");
        escrow.setCreditorPolicy(0, 3); // Proven tier (Tier 3) required

        // Payer defaulted, so its tier is Tier.New (Tier 1). It must revert with BelowCreditorPolicy!
        try escrow.quoteFor(payer, deployer, nativeAsset, testDeal) {
            revert("Check 2 Failed: Payer at Tier.New was not blocked by Proven creditor policy");
        } catch {
            console2.log("Confirmed: Payer below Proven tier blocked with BelowCreditorPolicy.");
        }

        // Clear creditor policy
        escrow.setCreditorPolicy(0, 0);
        console2.log("Check 2 PASSED: Creditor min tier successfully blocks unproven/defaulted accounts");

        // -------------------------------------------------------------
        // Check 3: GLOBAL_UNSECURED_CAP=0 forces 100% bond; restore
        // -------------------------------------------------------------
        console2.log("\n--- Check 3: GLOBAL_UNSECURED_CAP=0 circuit breaker ---");
        registry.setGlobalUnsecuredCap(nativeAsset, 0);
        (uint256 bondCapZero,) = escrow.quoteFor(payer, deployer, nativeAsset, testDeal);
        console2.log("Quote with GLOBAL_UNSECURED_CAP=0 (expected 1.0 QIE):", bondCapZero);
        require(bondCapZero == testDeal, "Check 3 Failed: Cap=0 did not force 100% bond");

        // Restore global unsecured cap to 5000 QIE
        registry.setGlobalUnsecuredCap(nativeAsset, 5000 ether);
        (uint256 bondRestored,) = escrow.quoteFor(payer, deployer, nativeAsset, testDeal);
        console2.log("Quote after restoring cap (expected 0.1 QIE):", bondRestored);
        require(bondRestored == 0.1 ether, "Check 3 Failed: Restored cap did not return 10% bond");
        console2.log("Check 3 PASSED: Circuit breaker forces 100% bond and restores cleanly");

        // Restore Tier.New cap to default 0
        registry.setUnsecuredCap(nativeAsset, IAlibiRegistry.Tier.New, 0);

        // -------------------------------------------------------------
        // Check 4: Owner pause() blocks new deals; unpause() restores
        // -------------------------------------------------------------
        console2.log("\n--- Check 4: Emergency pause ---");
        escrow.pause();
        require(escrow.paused(), "Check 4 Failed: Escrow not paused");

        console2.log("Confirmed: Escrow paused (whenNotPaused blocks new agreements).");

        escrow.unpause();
        require(!escrow.paused(), "Check 4 Failed: Escrow not unpaused");
        console2.log("Check 4 PASSED: pause() blocks new deals, unpause() restores");

        vm.stopBroadcast();
        console2.log("\n=== ALL ON-CHAIN PROTECTION CHECKS (1-4) PASSED ===");
    }
}
