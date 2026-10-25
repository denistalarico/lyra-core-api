import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  buildOrionManifest,
  renderOrionManifest,
} from '../modules/orion/manifest/orion-manifest.generator';

/**
 * OR4 — regenerates the Orion capabilities manifest.
 *
 *   pnpm orion:manifest                 # web app at ../../apps/lyra-agency-web
 *   ORION_WEB_ROOT=/path pnpm orion:manifest
 *
 * The output is committed; `orion-manifest.spec.ts` fails when it drifts
 * from the web command catalog.
 */
const webRoot = resolve(
  process.env.ORION_WEB_ROOT ??
    join(__dirname, '..', '..', '..', '..', 'apps', 'lyra-agency-web'),
);
const target = join(
  __dirname,
  '..',
  'modules',
  'orion',
  'manifest',
  'orion-capabilities.manifest.ts',
);
const manifest = buildOrionManifest(webRoot);
writeFileSync(target, renderOrionManifest(manifest));
console.log(
  `orion manifest: ${manifest.commands.length} commands, ${manifest.routes.length} routes, ${manifest.tools.length} tools → ${target}`,
);
