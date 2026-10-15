import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

describe('NineGrid beta release identity', () => {
  it('uses the requested beta version and visible product label', async () => {
    const [packageJson, titlebar, startup, settings, index, app] = await Promise.all([
      read('../package.json'),
      read('../public/ninegrid-titlebar.js'),
      read('../desktop/startup.html'),
      read('../desktop/settings.html'),
      read('../index.html'),
      read('../src/App.tsx'),
    ]);

    expect(JSON.parse(packageJson).version).toBe('1.0.0-beta.1');
    for (const source of [titlebar, startup, settings, index, app]) {
      expect(source).toContain('九格行动1.0测试版');
    }
  });

  it('keeps the installed app identity and F drive data paths stable across upgrades', async () => {
    const [packageJson, main] = await Promise.all([read('../package.json'), read('../desktop/main.cjs')]);
    const config = JSON.parse(packageJson).build;

    expect(config.appId).toBe('com.ninegrid.learning');
    expect(config.productName).toBe('九格行动 NineGrid');
    expect(main).toContain("app.setPath('userData', path.join(app.getPath('appData'), 'NineGrid'))");
    expect(main).toContain("const DEFAULT_DATA_ROOT = 'F:\\\\Projects\\\\NineGridData'");
  });
});
