import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createCloseGate } = require('../desktop/close-gate.cjs') as { createCloseGate: () => { shouldIntercept: () => boolean; approveOnce: () => void } };

describe('desktop close gate', () => {
  it('holds the window until the renderer confirms, then allows only that close', () => {
    const gate = createCloseGate();

    expect(gate.shouldIntercept()).toBe(true);
    gate.approveOnce();
    expect(gate.shouldIntercept()).toBe(false);
    expect(gate.shouldIntercept()).toBe(true);
  });
});
