import { describe, expect, it } from 'vitest';
import { createDesktopBuildInfo } from '../desktop/build-metadata.cjs';

describe('desktop build metadata', () => {
  it('records the package version and exact source commit used for the build', () => {
    const info = createDesktopBuildInfo({
      version: '0.1.14',
      commit: '1234567890abcdef1234567890abcdef12345678',
      branch: 'codex/learning-loop-fixes',
      dirty: false,
      nodeVersion: 'v24.11.1',
      postgresRuntime: 'postgres (PostgreSQL) 18.1',
      builtAt: '2026-10-15T02:00:00.000Z',
    });

    expect(info).toEqual({
      version: '0.1.14',
      commit: '1234567890ab',
      sourceCommit: '1234567890abcdef1234567890abcdef12345678',
      branch: 'codex/learning-loop-fixes',
      workingTreeModified: false,
      nodeVersion: 'v24.11.1',
      postgresRuntime: 'postgres (PostgreSQL) 18.1',
      builtAt: '2026-10-15T02:00:00.000Z',
    });
  });

  it('refuses to label an installer with a commit when tracked source is dirty', () => {
    expect(() => createDesktopBuildInfo({
      version: '0.1.14',
      commit: '1234567890abcdef1234567890abcdef12345678',
      branch: 'codex/learning-loop-fixes',
      dirty: true,
      nodeVersion: 'v24.11.1',
      postgresRuntime: 'postgres (PostgreSQL) 18.1',
      builtAt: '2026-10-15T02:00:00.000Z',
    })).toThrow('clean committed source');
  });
});
