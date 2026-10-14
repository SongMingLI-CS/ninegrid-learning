import { describe, expect, it } from 'vitest';
import { publicDatabaseIdentity } from '../server/runtimeInfo';

describe('public runtime identity', () => {
  it('exposes database routing identity without exposing credentials', () => {
    expect(publicDatabaseIdentity('postgresql://learner:secret-value@127.0.0.1:5433/ninegrid_dev'))
      .toEqual({ host: '127.0.0.1', port: 5433, database: 'ninegrid_dev' });
    expect(JSON.stringify(publicDatabaseIdentity('postgresql://learner:secret-value@127.0.0.1:5433/ninegrid_dev')))
      .not.toContain('secret-value');
  });

  it('returns no identity for a missing or invalid connection URL', () => {
    expect(publicDatabaseIdentity(undefined)).toBeNull();
    expect(publicDatabaseIdentity('not-a-url')).toBeNull();
  });
});
