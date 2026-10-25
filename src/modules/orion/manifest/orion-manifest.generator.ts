import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import { getPermissionDefinition } from '../../permissions/catalog/permission-keys.catalog';
import { ORION_TOOL_CATALOG } from '../tools/orion-tool-catalog';
import type { OrionCapabilitiesManifest } from './orion-manifest.types';

/**
 * Where a feature is configured, by screen. Labels are hand-written (the
 * routes carry no titles); every path is proven to exist as a Next.js page
 * when the manifest is generated, so a renamed screen fails the generator
 * instead of becoming a dead link in an answer.
 */
const ROUTE_CATALOG: ReadonlyArray<{ path: string; label: string }> = [
  { path: '/leadflow', label: 'LeadFlow: visão geral' },
  { path: '/leadflow/agents', label: 'Agentes e Operations Room' },
  { path: '/leadflow/analytics', label: 'Analytics do LeadFlow' },
  { path: '/leadflow/inbox', label: 'Inbox (conversas)' },
  {
    path: '/leadflow/inbox/settings',
    label: 'Configurações do Inbox e canais',
  },
  { path: '/leadflow/channels/whatsapp', label: 'Canal WhatsApp' },
  { path: '/leadflow/channels/instagram', label: 'Canal Instagram' },
  { path: '/leadflow/channels/facebook-messenger', label: 'Canal Messenger' },
  { path: '/leadflow/channels/webchat', label: 'Canal Webchat' },
  { path: '/leadflow/channels/sms', label: 'Canal SMS' },
  { path: '/leadflow/crm', label: 'CRM: funil de oportunidades' },
  { path: '/leadflow/crm/contacts', label: 'CRM: contatos' },
  { path: '/leadflow/crm/settings', label: 'CRM: funis e etapas' },
  { path: '/leadflow/appointments', label: 'Agenda' },
  { path: '/leadflow/appointments/settings', label: 'Configurações da agenda' },
  { path: '/leadflow/automations', label: 'Automações' },
  { path: '/leadflow/automations/webhooks', label: 'Webhooks de saída' },
  {
    path: '/leadflow/settings',
    label: 'Configurações do LeadFlow (business mode, briefing)',
  },
  { path: '/social', label: 'Social: visão geral' },
  { path: '/social/planner', label: 'Planner de conteúdo' },
  { path: '/social/creative-studio', label: 'Creative Studio' },
  { path: '/social/approvals', label: 'Aprovações' },
  { path: '/social/publishing', label: 'Publicação' },
  { path: '/social/analytics', label: 'Social Analytics' },
  { path: '/social/campaigns', label: 'Campanhas (Meta Ads)' },
  { path: '/social/brand-kit', label: 'Brand Kit' },
  { path: '/social/settings', label: 'Configurações do Social' },
  { path: '/knowledge/help', label: 'Central de Ajuda' },
];

const COMMAND_CATALOG =
  'src/modules/leadflow/agents/operations-room/chat/operations-room-command-catalog.ts';

/**
 * OR4 — builds the Orion capabilities manifest (§3.4 item 2) from code:
 * the Operations Room command catalog of the web app (what the room already
 * answers without AI), the route map above and the permission each tool
 * stands in for. The result is committed as a `.ts` module and loaded into
 * the stable prompt prefix, so `nest build` never depends on the web tree.
 */
export function buildOrionManifest(webRoot: string): OrionCapabilitiesManifest {
  const source = readFileSync(join(webRoot, COMMAND_CATALOG), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const sandbox = {
    exports: {} as Record<string, unknown>,
    require: () => ({}),
  };
  runInNewContext(compiled, sandbox, { timeout: 1_000 });
  const getCommands = sandbox.exports.getOperationsRoomCommands as (
    businessModeKey: string,
  ) => Array<{
    slash: string;
    label: string;
    description: string;
    example: string;
    availability: string;
  }>;

  const missing = ROUTE_CATALOG.filter(
    (route) => !existsSync(join(webRoot, 'src/app', route.path, 'page.tsx')),
  );
  if (missing.length)
    throw new Error(
      `orion manifest routes without a page: ${missing.map((r) => r.path).join(', ')}`,
    );

  return {
    version: 1,
    commands: getCommands('').map((command) => ({
      slash: command.slash,
      label: command.label,
      description: command.description,
      example: command.example,
      ready: command.availability === 'ready',
    })),
    routes: ROUTE_CATALOG.map((route) => ({ ...route })),
    tools: ORION_TOOL_CATALOG.map((tool) => ({
      name: tool.name,
      needs: tool.requirement
        ? tool.requirement.agency.anyOf.map((key) => {
            const definition = getPermissionDefinition(key);
            return definition
              ? [
                  definition.productKey,
                  definition.moduleKey,
                  definition.resourceKey,
                  definition.actionKey,
                ].join(' · ')
              : key;
          })
        : [],
      clientArea: tool.clientArea,
    })),
  };
}

export function renderOrionManifest(
  manifest: OrionCapabilitiesManifest,
): string {
  return (
    '// GENERATED by `pnpm orion:manifest` (src/scripts/generate-orion-manifest.ts).\n' +
    '// Do not edit by hand: change the web command catalog, the route list in\n' +
    '// orion-manifest.generator.ts or the tool catalog, then regenerate.\n' +
    "import type { OrionCapabilitiesManifest } from './orion-manifest.types';\n\n" +
    'export const ORION_CAPABILITIES_MANIFEST: OrionCapabilitiesManifest = ' +
    `${JSON.stringify(manifest, null, 2)};\n`
  );
}
