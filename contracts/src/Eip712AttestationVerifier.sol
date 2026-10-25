// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IAttestationVerifier} from "./interfaces/IAttestationVerifier.sol";

/// @title Eip712AttestationVerifier
/// @notice "Mode B" verifier: accepts EIP-712 attestations signed by an Alibi attestor key.
///         The attestor service only signs after it has confirmed the user's QIE Pass status
///         through QIE's partner API (user consent in QIE Wallet) and the user proved control
///         of the wallet being linked.
/// @dev    Trust assumption (state it plainly in the pitch): the attestor is a trusted relayer
///         between QIE Pass (off-chain KYC) and the EVM. Multiple attestors are supported so the
///         key can be rotated without downtime, and the whole verifier can be swapped in the
///         registry the day QIE exposes a native on-chain credential.
contract Eip712AttestationVerifier is EIP712, Ownable2Step, IAttestationVerifier {
    bytes32 public constant ATTESTATION_TYPEHASH = keccak256(
        "Attestation(address wallet,bytes32 identityId,bool kycVerified,uint64 issuedAt,uint64 expiresAt,uint256 nonce)"
    );

    mapping(address => bool) public isAttestor;

    event AttestorSet(address indexed attestor, bool allowed);

    error ZeroAddress();

    constructor(address owner_, address attestor_) EIP712("AlibiAttestation", "1") Ownable(owner_) {
        if (attestor_ == address(0)) revert ZeroAddress();
        isAttestor[attestor_] = true;
        emit AttestorSet(attestor_, true);
    }

    function setAttestor(address attestor, bool allowed) external onlyOwner {
        if (attestor == address(0)) revert ZeroAddress();
        isAttestor[attestor] = allowed;
        emit AttestorSet(attestor, allowed);
    }

    function hashAttestation(Attestation calldata att) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ATTESTATION_TYPEHASH, att.wallet, att.identityId, att.kycVerified, att.issuedAt, att.expiresAt, att.nonce
                )
            )
        );
    }

    function verify(Attestation calldata att, bytes calldata signature) external view returns (bool) {
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(hashAttestation(att), signature);
        return err == ECDSA.RecoverError.NoError && isAttestor[signer];
    }

    /// @notice EIP-712 domain separator, exposed so off-chain signers can sanity-check it.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
