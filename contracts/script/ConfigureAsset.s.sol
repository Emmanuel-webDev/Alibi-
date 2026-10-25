// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AlibiIdentityRegistry} from "../src/AlibiIdentityRegistry.sol";
import {IAlibiRegistry} from "../src/interfaces/IAlibiRegistry.sol";

/// @notice Configures credit caps and minimum deal size for an ERC-20 asset (e.g. QUSDC).
///         Owner-only. All values must be in the asset's own token units (e.g., 6 decimals).
///
/// Required env:
///   DEPLOYER_PRIVATE_KEY (owner of the registry)
///   REGISTRY (or REGISTRY_ADDRESS)
///   ASSET_ADDRESS (or QUSDC_ADDRESS)
///
/// Optional env (defaults assume 6-decimal units, e.g. 50, 200, 1000, 1 QUSDC):
///   BASE_CAP_UNITS              default 50_000_000 (50 units)
///   PROVEN_CAP_UNITS            default 200_000_000 (200 units)
///   GLOBAL_UNSECURED_CAP_UNITS  default 1_000_000_000 (1,000 units)
///   REP_MIN_DEAL_UNITS          default 1_000_000 (1 unit)
contract ConfigureAsset is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address registryAddr = vm.envOr("REGISTRY", vm.envOr("REGISTRY_ADDRESS", address(0)));
        require(registryAddr != address(0), "Missing REGISTRY address");

        address asset = vm.envOr("ASSET_ADDRESS", vm.envOr("QUSDC_ADDRESS", address(0)));
        require(asset != address(0), "Missing ASSET_ADDRESS");

        uint256 baseCap = vm.envOr("BASE_CAP_UNITS", uint256(50_000_000));
        uint256 provenCap = vm.envOr("PROVEN_CAP_UNITS", uint256(200_000_000));
        uint256 globalCap = vm.envOr("GLOBAL_UNSECURED_CAP_UNITS", uint256(1_000_000_000));
        uint256 repMinDeal = vm.envOr("REP_MIN_DEAL_UNITS", uint256(1_000_000));

        AlibiIdentityRegistry registry = AlibiIdentityRegistry(registryAddr);

        vm.startBroadcast(pk);
        registry.setUnsecuredCap(asset, IAlibiRegistry.Tier.Base, baseCap);
        registry.setUnsecuredCap(asset, IAlibiRegistry.Tier.Proven, provenCap);
        registry.setGlobalUnsecuredCap(asset, globalCap);
        registry.setRepMinDeal(asset, repMinDeal);
        vm.stopBroadcast();

        console2.log("Configured asset:", asset);
        console2.log("  Base Cap:             ", baseCap);
        console2.log("  Proven Cap:           ", provenCap);
        console2.log("  Global Unsecured Cap: ", globalCap);
        console2.log("  Rep Min Deal:         ", repMinDeal);
    }
}
