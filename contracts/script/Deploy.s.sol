// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IAlibiRegistry} from "../src/interfaces/IAlibiRegistry.sol";
import {Eip712AttestationVerifier} from "../src/Eip712AttestationVerifier.sol";
import {AlibiIdentityRegistry} from "../src/AlibiIdentityRegistry.sol";
import {AlibiCreditEscrow} from "../src/AlibiCreditEscrow.sol";
import {AlibiSlashingRouter} from "../src/AlibiSlashingRouter.sol";
import {AlibiGatedVault} from "../src/AlibiGatedVault.sol";

/// @notice Deploys the full Alibi stack.
///
///   TESTNET (chain 1983) deploys freely.
///   ANY OTHER CHAIN (i.e. mainnet) refuses to run unless ALLOW_MAINNET=true is set explicitly.
///
///   forge script script/Deploy.s.sol --rpc-url $QIE_TESTNET_RPC --broadcast
///
/// Required env:  DEPLOYER_PRIVATE_KEY, ATTESTOR_ADDRESS
/// Optional env:  FEE_RECIPIENT, MIN_DURATION (seconds, default 15), FEE_BPS (default 50), MAX_CLAIMS (default 10),
///                BASE_CAP_WEI, PROVEN_CAP_WEI, GLOBAL_UNSECURED_CAP_WEI, REP_MIN_DEAL_WEI, GRANT_WEI, ALLOW_MAINNET
contract Deploy is Script {
    uint256 internal constant QIE_TESTNET_CHAIN_ID = 1983;

    struct Deployed {
        Eip712AttestationVerifier verifier;
        AlibiIdentityRegistry registry;
        AlibiCreditEscrow escrow;
        AlibiSlashingRouter router;
        AlibiGatedVault vault;
    }

    struct Config {
        uint256 pk;
        address deployer;
        address attestor;
        address feeRecipient;
        uint64 minDuration;
        uint16 feeBps;
        uint256 maxClaims;
        uint256 baseCap;
        uint256 provenCap;
        uint256 globalCap;
        uint256 repMinDeal;
        uint256 grant;
    }

    function run() external returns (Deployed memory d) {
        if (block.chainid != QIE_TESTNET_CHAIN_ID) {
            require(
                vm.envOr("ALLOW_MAINNET", false),
                "Refusing to deploy off-testnet. Set ALLOW_MAINNET=true once the testnet run is signed off."
            );
        }
        Config memory c = _config();
        d = _deploy(c);
        _log(d, c);
        _record(d, c);
    }

    function _config() internal view returns (Config memory c) {
        c.pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        c.deployer = vm.addr(c.pk);
        c.attestor = vm.envAddress("ATTESTOR_ADDRESS");
        c.feeRecipient = vm.envOr("FEE_RECIPIENT", c.deployer);
        c.minDuration = uint64(vm.envOr("MIN_DURATION", uint256(15)));
        c.feeBps = uint16(vm.envOr("FEE_BPS", uint256(50)));
        c.maxClaims = vm.envOr("MAX_CLAIMS", uint256(10));
        c.baseCap = vm.envOr("BASE_CAP_WEI", uint256(50 ether));
        c.provenCap = vm.envOr("PROVEN_CAP_WEI", uint256(200 ether));
        c.globalCap = vm.envOr("GLOBAL_UNSECURED_CAP_WEI", uint256(1_000 ether));
        c.repMinDeal = vm.envOr("REP_MIN_DEAL_WEI", uint256(1 ether));
        c.grant = vm.envOr("GRANT_WEI", uint256(1 ether));
    }

    function _deploy(Config memory c) internal returns (Deployed memory d) {
        vm.startBroadcast(c.pk);
        d.verifier = new Eip712AttestationVerifier(c.deployer, c.attestor);
        d.registry = new AlibiIdentityRegistry(c.deployer, d.verifier);
        d.escrow = new AlibiCreditEscrow(c.deployer, d.registry, c.minDuration, c.feeBps, c.feeRecipient);
        d.router = new AlibiSlashingRouter(d.registry, c.maxClaims);
        d.vault = new AlibiGatedVault(c.deployer, d.registry, d.router, c.grant);

        d.registry.setModules(address(d.escrow), address(d.router));
        d.registry.setUnsecuredCap(address(0), IAlibiRegistry.Tier.Base, c.baseCap);
        d.registry.setUnsecuredCap(address(0), IAlibiRegistry.Tier.Proven, c.provenCap);
        d.registry.setGlobalUnsecuredCap(address(0), c.globalCap);
        d.registry.setRepMinDeal(address(0), c.repMinDeal);
        vm.stopBroadcast();
    }

    function _log(Deployed memory d, Config memory c) internal view {
        console2.log("chainId           ", block.chainid);
        console2.log("deployer/owner    ", c.deployer);
        console2.log("attestor          ", c.attestor);
        console2.log("minDuration (s)   ", c.minDuration);
        console2.log("Verifier          ", address(d.verifier));
        console2.log("Registry          ", address(d.registry));
        console2.log("Escrow            ", address(d.escrow));
        console2.log("Router            ", address(d.router));
        console2.log("GatedVault        ", address(d.vault));
    }

    function _record(Deployed memory d, Config memory c) internal {
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeAddress(k, "owner", c.deployer);
        vm.serializeAddress(k, "attestor", c.attestor);
        vm.serializeUint(k, "minDuration", c.minDuration);
        vm.serializeAddress(k, "verifier", address(d.verifier));
        vm.serializeAddress(k, "registry", address(d.registry));
        vm.serializeAddress(k, "escrow", address(d.escrow));
        vm.serializeAddress(k, "router", address(d.router));
        string memory json = vm.serializeAddress(k, "vault", address(d.vault));
        vm.writeJson(json, string.concat("../deployments/", vm.toString(block.chainid), ".json"));
    }
}
