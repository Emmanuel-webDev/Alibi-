// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AlibiIdentityRegistry} from "../src/AlibiIdentityRegistry.sol";
import {AlibiGatedVault} from "../src/AlibiGatedVault.sol";

/// @notice DEMO ONLY. Gives the demo identity a "Proven" reputation head-start and funds the grant pool,
///         so the Judge Sandbox can show the 10% bond tier without a month of real history.
///         The seeding is public (ReputationSeeded event) and switched off forever by Finalize.
///
///   DEMO_IDENTITY_ID  bytes32: the same identityId the attestor signs for the demo user
///                     (the backend prints it: GET /api/identity-id?handle=alice.qie)
contract SeedDemo is Script {
    function run() external {
        require(block.chainid == 1983, "SeedDemo can only run on QIE testnet (chain 1983)");

        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        AlibiIdentityRegistry registry = AlibiIdentityRegistry(vm.envAddress("REGISTRY"));
        bytes32 identityId = vm.envBytes32("DEMO_IDENTITY_ID");

        vm.startBroadcast(pk);
        registry.seedReputation(identityId, 10, 4, uint64(block.timestamp - 31 days));
        address vaultAddr = vm.envOr("VAULT", address(0));
        uint256 fund = vm.envOr("FUND_VAULT_WEI", uint256(0));
        if (vaultAddr != address(0) && fund > 0) {
            AlibiGatedVault(payable(vaultAddr)).fundGrants{value: fund}();
        }
        vm.stopBroadcast();

        console2.log("seeded identity", vm.toString(identityId));
    }
}
