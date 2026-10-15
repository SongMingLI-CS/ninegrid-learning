function createDesktopBuildInfo({ version, commit, branch, dirty, nodeVersion, postgresRuntime, builtAt }) {
  if (dirty) throw new Error('Desktop installers must be built from clean committed source.');
  if (!version || !/^[a-f0-9]{40}$/i.test(commit ?? '') || !branch) {
    throw new Error('Desktop build metadata requires a package version, full source commit and branch.');
  }
  return {
    version,
    commit: commit.slice(0, 12),
    sourceCommit: commit,
    branch,
    workingTreeModified: false,
    nodeVersion,
    postgresRuntime,
    builtAt,
  };
}

module.exports = { createDesktopBuildInfo };
