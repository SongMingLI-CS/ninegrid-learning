export function decryptStoredText(encrypted: Buffer, storage: { decryptStringAsync(value: Buffer): Promise<string | { result: string; shouldReEncrypt: boolean }> }): Promise<string>;
