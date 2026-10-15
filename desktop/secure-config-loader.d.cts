export type SecureConfigLoadResult =
  | { ok: true; values: Record<string, string> }
  | { ok: false; reason: 'missing' | 'read-failed' | 'encryption-unavailable' | 'decrypt-failed' | 'parse-failed' | 'invalid-fields' };

export function readSecureConfiguration(options: {
  filePath: string;
  readFile: (filePath: string) => Promise<Uint8Array>;
  isEncryptionAvailable: () => Promise<boolean>;
  decrypt: (encrypted: Uint8Array) => Promise<string>;
  validate: (values: Record<string, string>) => { ok: boolean };
  fileExists?: (filePath: string) => Promise<boolean | undefined>;
  onStage?: (stage: string, details?: Record<string, unknown>) => void;
}): Promise<SecureConfigLoadResult>;
