import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
const { JSDOM } = require('jsdom') as {
  JSDOM: new (html: string, options: { runScripts: string; url: string }) => {
    window: Window & typeof globalThis & { nineGridDesktop?: Record<string, unknown> };
    close: () => void;
  };
};
const { windowChromeOptions } = require('../desktop/window-chrome.cjs') as { windowChromeOptions: () => Record<string, unknown> };

const titlebarSource = readFileSync(new URL('../public/ninegrid-titlebar.js', import.meta.url), 'utf8');
const titlebarCss = readFileSync(new URL('../public/ninegrid-titlebar.css', import.meta.url), 'utf8');
const hostCss = readFileSync(new URL('../public/ninegrid-titlebar-host.css', import.meta.url), 'utf8');

function createWindow(api?: Record<string, unknown>) {
  const dom = new JSDOM('<!doctype html><html><head><link rel="stylesheet" href="/ninegrid-titlebar-host.css" data-ninegrid-titlebar data-shadow-stylesheet="/ninegrid-titlebar.css"></head><body><ninegrid-titlebar></ninegrid-titlebar></body></html>', {
    runScripts: 'outside-only',
    url: 'http://127.0.0.1:8787/',
  });
  if (api) Object.defineProperty(dom.window, 'nineGridDesktop', { value: api });
  dom.window.eval(titlebarSource);
  return dom;
}

describe('Electron title bar chrome', () => {
  it('uses a dark 44px native title bar overlay on every Electron window', () => {
    expect(windowChromeOptions()).toMatchObject({
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#11191c', symbolColor: '#e3ebe6', height: 44 },
      autoHideMenuBar: true,
      backgroundColor: '#11191c',
    });
  });

  it('removes the desktop title bar completely in an ordinary browser', () => {
    const dom = createWindow();
    expect(dom.window.document.querySelector('ninegrid-titlebar')).toBeNull();
    expect(dom.window.document.documentElement.classList.contains('ninegrid-desktop')).toBe(false);
    dom.window.close();
  });

  it('renders native-window-safe drag and action regions with accessible menu actions', async () => {
    const setZoom = vi.fn(async value => value);
    const openSettings = vi.fn(async () => true);
    const api = {
      openSettings,
      setZoom,
      createBackup: vi.fn(async () => '备份完成'),
      openLogs: vi.fn(async () => true),
      getSettings: vi.fn(async () => ({ version: '0.1.1', commit: 'test12345678', zoom: 1 })),
    };
    const dom = createWindow(api);
    const host = dom.window.document.querySelector('ninegrid-titlebar')!;
    const shadow = host.shadowRoot!;
    expect(dom.window.document.documentElement.classList.contains('ninegrid-desktop')).toBe(true);
    expect(shadow.querySelector('[data-drag-region]')).not.toBeNull();
    expect(shadow.querySelector('[data-no-drag]')).not.toBeNull();
    expect(shadow.querySelector('link[rel="stylesheet"]')?.getAttribute('href')).toBe('http://127.0.0.1:8787/ninegrid-titlebar.css');
    expect(hostCss).toContain('env(titlebar-area-width');
    expect(titlebarCss).toContain('-webkit-app-region: drag');
    expect(titlebarCss).toContain('-webkit-app-region: no-drag');

    const menuToggle = shadow.querySelector<HTMLButtonElement>('[data-menu-toggle]')!;
    menuToggle.click();
    expect(menuToggle.getAttribute('aria-expanded')).toBe('true');
    expect(shadow.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe('更多');
    expect(shadow.activeElement).toBe(shadow.querySelector('[data-action="zoom-in"]'));
    shadow.activeElement!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    expect(menuToggle.getAttribute('aria-expanded')).toBe('false');
    menuToggle.click();
    shadow.querySelector<HTMLButtonElement>('[data-action="zoom-in"]')!.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(setZoom).toHaveBeenCalledWith(1.1);
    expect(shadow.textContent).toContain('0.1.1 · test12345678');
    shadow.querySelector<HTMLButtonElement>('[data-action="settings"]')!.click();
    expect(openSettings).toHaveBeenCalledOnce();
    shadow.querySelector<HTMLButtonElement>('[data-action="backup"]')!.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(api.createBackup).toHaveBeenCalledOnce();
    shadow.querySelector<HTMLButtonElement>('[data-action="logs"]')!.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(api.openLogs).toHaveBeenCalledOnce();
    dom.window.close();
  });

  it('shares the same title bar on startup, settings, and app pages without changing browser navigation', () => {
    const root = new URL('..', import.meta.url);
    const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
    const main = read('desktop/main.cjs');
    expect(read('index.html')).toContain('<ninegrid-titlebar></ninegrid-titlebar>');
    expect(read('desktop/startup.html')).toContain('../dist/ninegrid-titlebar.js');
    expect(read('desktop/settings.html')).toContain('../dist/ninegrid-titlebar.js');
    expect(read('src/styles-overrides.css')).toContain('html.ninegrid-desktop');
    expect(read('index.html')).toContain('ninegrid-titlebar-host.css');
    expect(hostCss).not.toMatch(/\n\.brand\s*\{/);
    expect(main.match(/windowChromeOptions\(\)/g)).toHaveLength(3);
    expect(main).toContain('Menu.setApplicationMenu(null)');
  });
});
