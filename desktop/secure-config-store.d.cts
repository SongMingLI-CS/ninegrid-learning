export function persistSecureConfiguration(options: {
  filePath: string;
  values: Record<string, string>;
  encrypt: (plaintext: string) => Promise<Uint8Array>;
  decrypt: (encrypted: Uint8Array) => Promise<string>;
  validate: (values: Record<string, string>) => { ok: boolean };
  readFile?: (filePath: string) => Promise<Uint8Array>;
  writeFile?: (filePath: string, bytes: Uint8Array, options?: { flag?: string }) => Promise<void>;
  rename?: (from: string, to: string) => Promise<void>;
  unlink?: (filePath: string) => Promise<void>;
  mkdir?: (directory: string, options?: { recursive?: boolean }) => Promise<void>;
  onStage?: (stage: string, details?: { phase?: string; code?: string }) => void;
}): Promise<{ ok: true; values: Record<string, string> }>;
