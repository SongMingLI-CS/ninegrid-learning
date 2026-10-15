import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const startupScript = readFileSync(new URL('../desktop/startup.js', import.meta.url), 'utf8');

function mountStartup(importConfiguration: () => Promise<boolean>) {
  const elements = new Map<string, { addEventListener: (name: string, handler: () => unknown) => void; handler?: () => unknown; style: { width: string }; hidden: boolean; textContent: string }>();
  for (const selector of ['#detail', '#error', '#progress', '#actions', '#retry', '#chooseData', '#importConfig']) {
    elements.set(selector, { addEventListener(name, handler) { if (name === 'click') this.handler = handler; }, style: { width: '' }, hidden: false, textContent: '' });
  }
  const retryStartup = vi.fn(async () => true);
  const api = { onStartupProgress: vi.fn(), importConfiguration, retryStartup, chooseDataDirectory: vi.fn(async () => true) };
  const document = { querySelector: (selector: string) => elements.get(selector) };
  runInNewContext(startupScript, { window: { nineGridDesktop: api }, document, Error });
  return { elements, api };
}

describe('desktop startup configuration import', () => {
  it('continues startup after the user successfully imports configuration', async () => {
    const importConfiguration = vi.fn(async () => true);
    const { elements, api } = mountStartup(importConfiguration);

    await elements.get('#importConfig')?.handler?.();

    expect(importConfiguration).toHaveBeenCalledOnce();
    expect(api.retryStartup).toHaveBeenCalledOnce();
  });

  it('does not retry startup when the user cancels configuration import', async () => {
    const { elements, api } = mountStartup(async () => false);

    await elements.get('#importConfig')?.handler?.();

    expect(api.retryStartup).not.toHaveBeenCalled();
  });
});
