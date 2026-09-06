import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const MODULE_ROOT = join(__dirname, '..');
const RESOLVER = 'credentials/social-organic-credential.resolver.ts';

function sourceFiles(directory: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      found.push(path);
    }
  }

  return found;
}

const SOURCES = sourceFiles(MODULE_ROOT).map((path) => ({
  relativePath: path
    .slice(MODULE_ROOT.length + 1)
    .split('\\')
    .join('/'),
  content: readFileSync(path, 'utf8'),
}));

function filesContaining(pattern: RegExp): string[] {
  return SOURCES.filter((file) => pattern.test(file.content))
    .map((file) => file.relativePath)
    .sort();
}

describe('social organic credential boundary', () => {
  it('keeps decryption inside the resolver', () => {
    expect(filesContaining(/cryptoService\.decrypt\s*\(/)).toEqual([RESOLVER]);
  });

  it('keeps encrypted connection-token reads inside the resolver', () => {
    expect(filesContaining(/\.accessTokenEncrypted\b(?!\s*=)/)).toEqual([
      RESOLVER,
    ]);
  });

  it('keeps encrypted asset-token reads inside the resolver', () => {
    expect(filesContaining(/\.assetTokenEncrypted\b(?!\s*=)/)).toEqual([
      RESOLVER,
    ]);
  });

  it('branches on authorizationMethod in exactly one file', () => {
    expect(
      filesContaining(/switch\s*\([^)]*authorizationMethod[^)]*\)/),
    ).toEqual([RESOLVER]);
    expect(filesContaining(/case\s+['"]oauth_user['"]/)).toEqual([RESOLVER]);
    expect(filesContaining(/case\s+['"]oauth_business['"]/)).toEqual([
      RESOLVER,
    ]);
    expect(filesContaining(/case\s+['"]internal_system_user['"]/)).toEqual([
      RESOLVER,
    ]);
  });
});
