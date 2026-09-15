import { readFileSync } from 'fs';
import { join } from 'path';

function readCode(relativePath: string) {
  return readFileSync(join(__dirname, relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('Meta campaign operational hierarchy boundary', () => {
  it('has no route to provider calls or credentials', () => {
    const source = readCode('meta-campaign-hierarchy-read.service.ts');

    for (const forbidden of [
      'MetaAdsGraph',
      'CredentialResolver',
      'accessToken',
      'access_token',
      'fetch(',
      'axios',
      'httpService',
      'enqueue',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('binds the full server-resolved connection scope', () => {
    const source = readCode('meta-campaign-hierarchy-read.service.ts');

    expect(source).toContain('tenantId: input.tenantId');
    expect(source).toContain('workspaceId: input.workspaceId');
    expect(source).toContain('agencyClientId:');
    expect(source).toContain('provider: META_PROVIDER');
  });

  it('keeps tenant and workspace out of the public query DTO', () => {
    const source = readCode(
      '../dto/meta-campaign-hierarchy.query.dto.ts',
    );

    expect(source).not.toContain('tenantId');
    expect(source).not.toContain('workspaceId');
    expect(source).not.toContain('agencyClientId');
  });

  it('paginates campaigns before loading their descendants', () => {
    const source = readCode('meta-campaign-hierarchy-read.service.ts');

    expect(source).toContain('.skip((page - 1) * limit)');
    expect(source).toContain('.take(limit)');
    expect(source).toContain('readChildren');
  });
});
