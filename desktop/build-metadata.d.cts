export interface DesktopBuildInfoInput {
  version: string;
  commit: string;
  branch: string;
  dirty: boolean;
  nodeVersion: string;
  postgresRuntime: string;
  builtAt: string;
}

export interface DesktopBuildInfo extends Omit<DesktopBuildInfoInput, 'commit' | 'dirty'> {
  commit: string;
  sourceCommit: string;
  workingTreeModified: false;
}

export function createDesktopBuildInfo(input: DesktopBuildInfoInput): DesktopBuildInfo;
