function buildSnapshotConnectionString(applicationConnectionString, adminConnectionString) {
  if (!adminConnectionString) return applicationConnectionString;

  const applicationUrl = new URL(applicationConnectionString);
  const snapshotUrl = new URL(adminConnectionString);
  const postgresProtocols = new Set(['postgres:', 'postgresql:']);
  if (!postgresProtocols.has(applicationUrl.protocol) || !postgresProtocols.has(snapshotUrl.protocol)) {
    throw new Error('NineGrid snapshot connections must use PostgreSQL URLs.');
  }
  if (!applicationUrl.pathname || applicationUrl.pathname === '/') {
    throw new Error('NineGrid application database name is missing from its connection URL.');
  }

  snapshotUrl.pathname = applicationUrl.pathname;
  return snapshotUrl.toString();
}

module.exports = { buildSnapshotConnectionString };
