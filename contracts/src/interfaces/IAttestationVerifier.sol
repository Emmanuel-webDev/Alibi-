// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IAttestationVerifier
/// @notice Pluggable verification of "this wallet belongs to this QIE Pass identity".
///         Today: an EIP-712 attestation signed by Alibi's relayer after it checks the QIE Pass
///         partner API. If QIE ever ships a native on-chain credential, a new verifier that
///         reads it can be swapped in with `AlibiIdentityRegistry.setVerifier()`.
interface IAttestationVerifier {
    struct Attestation {
        address wallet; // the wallet being linked (must be the caller of linkWallet)
        bytes32 identityId; // opaque per-person/handle anchor derived from the QIE identity
        bool kycVerified; // QIE Pass verification status at issuance
        uint64 issuedAt;
        uint64 expiresAt;
        uint256 nonce; // must equal registry.attestationNonce(wallet): single-use
    }

    /// @return true iff `signature` is a valid attestation by a trusted attestor.
    function verify(Attestation calldata att, bytes calldata signature) external view returns (bool);
}
