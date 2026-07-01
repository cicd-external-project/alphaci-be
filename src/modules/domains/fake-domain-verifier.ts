import type {
  DomainVerificationInput,
  DomainVerificationResult,
  DomainVerifier,
  DomainVerifierMode,
} from './domains.types';

export interface FakeDomainVerifierOptions {
  mode?: DomainVerifierMode;
}

export class FakeDomainVerifier implements DomainVerifier {
  constructor(private readonly options: FakeDomainVerifierOptions = {}) {}

  async verify(
    input: DomainVerificationInput,
  ): Promise<DomainVerificationResult> {
    await Promise.resolve();
    const mode = this.options.mode ?? 'matched';
    const name = input.hostname;
    const dnsInstructions = {
      type: 'CNAME' as const,
      name,
      value: input.expectedTarget,
      status: mode,
      message: this.messageFor(mode),
    };

    return {
      mode,
      matched: mode === 'matched',
      dnsInstructions,
    };
  }

  private messageFor(mode: DomainVerifierMode): string {
    if (mode === 'matched') {
      return 'Expected DNS target matched.';
    }

    if (mode === 'mismatched') {
      return 'DNS record exists but points at a different target.';
    }

    return 'DNS record is missing.';
  }
}
