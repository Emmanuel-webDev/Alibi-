import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from 'viem'

/** Plain-language explanations for every custom error the Alibi contracts can throw. */
const KNOWN: Record<string, string> = {
  ActiveDefault: 'This identity has an unpaid default. It is paid off automatically when you receive a payment through Alibi.',
  InvalidParty: 'The creditor must be a different person: not the same wallet, and not another wallet linked to your identity.',
  InvalidAmount: 'Enter an amount greater than zero.',
  InvalidDuration: 'That duration is outside what this deployment allows.',
  NotOpen: 'This agreement is no longer open.',
  NotPayer: 'Only the wallet that opened the agreement can settle it.',
  DeadlinePassed: 'The deadline has passed. The agreement can now only be defaulted.',
  DeadlineNotReached: 'The deadline has not passed yet.',
  NativeValueMismatch: 'The QIE sent did not match the amount required. Refresh the quote and try again.',
  UnexpectedNativeValue: 'QIE was attached to a token payment. Nothing was sent.',
  BadNonce: 'This attestation was already used or is out of date. Start the link again.',
  AttestationExpired: 'The attestation expired. Start the link again.',
  InvalidAttestation: 'The attestation was not signed by a trusted attestor.',
  WalletLinkedToOtherIdentity: 'This wallet is already linked to a different identity. Wallet links cannot be changed.',
  TooManyWallets: 'This identity has reached its wallet limit.',
  NotLinked: 'Link this wallet to your QIE identity first.',
  StakeLocked: 'That stake is backing open agreements. Settle them to free it.',
  InsufficientStake: 'You asked to withdraw more than you have staked.',
  NothingToWithdraw: 'There is nothing to withdraw.',
  GrantAlreadyClaimed: 'This identity already claimed its grant.',
  AlibiActiveDefault: 'This identity has an unpaid default, so this action is blocked.',
  AlibiNotVerified: 'This wallet is not linked to a verified identity.',
  BelowCreditorPolicy: 'The creditor requires a higher bond or a higher tier than this wallet has. Try a different creditor or lock more up front.',
  InvalidPolicy: 'The bond share must be between 0% and 100%, and the tier between 0 and 3.',
  EnforcedPause: 'New agreements are paused right now. Settling and defaults still work.',
  ZeroAmount: 'Enter an amount greater than zero.',
  ZeroAddress: 'Enter a valid address.',
}

export function friendlyError(e: unknown): string {
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError)) return 'You declined the request in your wallet.'
    const reverted = e.walk((x) => x instanceof ContractFunctionRevertedError)
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName
      if (name && KNOWN[name]) return KNOWN[name]!
      if (name) return `The contract rejected this action (${name}).`
      if (reverted.reason) return `The contract rejected this action: ${reverted.reason}`
    }
    return e.shortMessage
  }
  return e instanceof Error ? e.message : 'Something went wrong. Try again.'
}
