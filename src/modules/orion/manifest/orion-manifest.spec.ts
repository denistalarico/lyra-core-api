import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ORION_TOOL_CATALOG } from '../tools/orion-tool-catalog';
import { ORION_CAPABILITIES_MANIFEST } from './orion-capabilities.manifest';
import { buildOrionManifest } from './orion-manifest.generator';

const webRoot = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  'apps',
  'lyra-agency-web',
);
const withWeb = existsSync(join(webRoot, 'src', 'app')) ? it : it.skip;

describe('Orion capabilities manifest', () => {
  withWeb(
    'is in sync with the web command catalog, routes and tools (run `pnpm orion:manifest`)',
    () => {
      expect(ORION_CAPABILITIES_MANIFEST).toEqual(buildOrionManifest(webRoot));
    },
  );

  it('describes every tool and only absolute in-app routes', () => {
    expect(ORION_CAPABILITIES_MANIFEST.tools.map((tool) => tool.name)).toEqual(
      ORION_TOOL_CATALOG.map((tool) => tool.name),
    );
    for (const route of ORION_CAPABILITIES_MANIFEST.routes)
      expect(route.path).toMatch(/^\/[a-z0-9/-]*$/);
    expect(ORION_CAPABILITIES_MANIFEST.commands.length).toBeGreaterThan(0);
  });

  it('no tool takes a scope argument (§3.5 item 2)', () => {
    for (const tool of ORION_TOOL_CATALOG) {
      const properties = Object.keys(
        (tool.parameters as { properties?: Record<string, unknown> })
          .properties ?? {},
      );
      for (const forbidden of [
        'tenantId',
        'workspaceId',
        'clientId',
        'agencyClientId',
        'companyContextId',
        'userId',
      ])
        expect(properties).not.toContain(forbidden);
    }
  });
});
