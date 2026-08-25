import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Guards the single-resolver rule.
 *
 * Lyra Social authorizes ad accounts two ways, and the whole design of S2 rests
 * on that difference being resolved in exactly one place. The failure mode this
 * spec exists to catch is not malice, it is convenience: someone writing the
 * insights reader needs a token, sees `SocialInternalAccessService` sitting
 * right there, and reaches for it directly. That works, ships, and quietly
 * creates a second credential path — one that a later fix to the first path
 * will not reach, carrying an agency-wide System User token.
 *
 * So the reach is what is guarded, not the branch. A copy is easy to spot in
 * review; a second caller of `requireSystemUserToken` in an unrelated file is
 * not. Adding a file to an allowlist below is deliberate, reviewable, and the
 * point at which someone has to justify the second path.
 */
const SOURCE_ROOT = join(__dirname, '..', '..', '..');

/** Files allowed to reach for the System User token. */
const SYSTEM_USER_TOKEN_READERS = [
  // Defines it.
  'modules/social-integrations/internal/social-internal-access.service.ts',
  // S1: binds the internal connection and reports its health.
  'modules/social-integrations/services/meta-ads-system-user.service.ts',
  // S2: the one resolver.
  'modules/social-integrations/credentials/social-ad-credential.resolver.ts',
];

/** Files allowed to decrypt a stored ad-account credential. */
const CONNECTION_TOKEN_DECRYPTERS = [
  // S1: validates the ciphertext before promoting a pending connection.
  'modules/social-integrations/services/meta-ads-oauth.service.ts',
  // S2: the one resolver.
  'modules/social-integrations/credentials/social-ad-credential.resolver.ts',
];

/** Files allowed to load the encrypted column past the entity's `select: false`. */
const CREDENTIAL_COLUMN_READERS = [
  'modules/social-integrations/services/meta-ads-oauth.service.ts',
  'modules/social-integrations/credentials/social-ad-credential.resolver.ts',
];

function sourceFiles(directory: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }

    // Specs describe the rule; they do not implement a credential path.
    if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      found.push(path);
    }
  }

  return found;
}

/** Read once: the tree is large and every assertion below scans all of it. */
const SOURCES = sourceFiles(SOURCE_ROOT).map((path) => ({
  relativePath: path
    .slice(SOURCE_ROOT.length + 1)
    .split('\\')
    .join('/'),
  content: readFileSync(path, 'utf8'),
}));

/**
 * Files matching a pattern, optionally within one module.
 *
 * The System User token and its variable are Social's own names, so those are
 * scanned across the whole API — a reference from anywhere is a finding.
 * Decryption and the encrypted column are shared vocabulary: the Inbox, the
 * vault and the settings module all decrypt their own credentials, and none of
 * that is this boundary's business. Those scans stay inside Social, or the
 * assertion becomes a list of every unrelated file that happens to hold a
 * secret.
 */
function filesContaining(pattern: RegExp, within = ''): string[] {
  return SOURCES.filter(
    (file) =>
      file.relativePath.startsWith(within) && pattern.test(file.content),
  )
    .map((file) => file.relativePath)
    .sort();
}

const SOCIAL = 'modules/social-integrations/';

describe('social ad credential boundary', () => {
  it('keeps the System User token to the files that may reach for it', () => {
    expect(filesContaining(/requireSystemUserToken\s*\(/)).toEqual(
      [...SYSTEM_USER_TOKEN_READERS].sort(),
    );
  });

  it('reads SOCIAL_META_ADS_SYSTEM_USER_TOKEN only through the gate', () => {
    // Naming the variable directly bypasses `isInternalScope` entirely, which
    // is the guardrail — not the token's storage location.
    expect(
      filesContaining(/process\.env\[?['"]?SOCIAL_META_ADS_SYSTEM_USER_TOKEN/),
    ).toEqual([
      'modules/social-integrations/internal/social-internal-access.service.ts',
    ]);
  });

  it('keeps credential decryption to the files that may decrypt', () => {
    expect(filesContaining(/cryptoService\.decrypt\s*\(/, SOCIAL)).toEqual(
      [...CONNECTION_TOKEN_DECRYPTERS].sort(),
    );
  });

  it('keeps the encrypted column to the files that may load it', () => {
    expect(
      filesContaining(/connection\.accessTokenEncrypted['"]/, SOCIAL),
    ).toEqual([...CREDENTIAL_COLUMN_READERS].sort());
  });

  it('branches on the authorization method in exactly one file', () => {
    // The literal appears in the entity (declaring the union), the migration
    // (the column default) and the S1 writer (binding the row). Only the
    // resolver may *dispatch* on it.
    expect(filesContaining(/case\s+['"]internal_system_user['"]/)).toEqual([
      'modules/social-integrations/credentials/social-ad-credential.resolver.ts',
    ]);
    expect(filesContaining(/case\s+['"]business_login['"]/)).toEqual([
      'modules/social-integrations/credentials/social-ad-credential.resolver.ts',
    ]);
  });
});
