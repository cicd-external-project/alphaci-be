declare module 'libsodium-wrappers' {
  const base64_variants: {
    ORIGINAL: number;
    ORIGINAL_NO_PADDING: number;
    URLSAFE: number;
    URLSAFE_NO_PADDING: number;
  };

  const ready: Promise<void>;

  function from_base64(input: string, variant?: number): Uint8Array;
  function from_string(str: string): Uint8Array;
  function to_base64(input: Uint8Array, variant?: number): string;
  function crypto_box_seal(message: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array;

  export { ready, base64_variants, from_base64, from_string, to_base64, crypto_box_seal };
}
