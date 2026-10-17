import type {
  ClientAreaAccessLevel,
  ClientAreaModuleKey,
  ClientAreaMemberAccess,
} from './client-area.types';

export type ClientAreaAgencyGrant = {
  key: string;
  methods: readonly string[];
  scope: 'client' | 'created_by_me';
  cost?: 'ai' | 'media';
};
const read = ['GET', 'HEAD'];
const grant = (
  key: string,
  methods: readonly string[],
  scope: ClientAreaAgencyGrant['scope'] = 'client',
): ClientAreaAgencyGrant => ({ key, methods, scope });

/** Explicit, method-bound grants: several existing Projects routes reuse a key for reads and writes.
 * CA10/CA11 append audited product projections here; no wildcard/Agency Owner expansion. */
export function projectAgencyPermissions(
  module: ClientAreaModuleKey,
  level: ClientAreaAccessLevel | null,
): readonly ClientAreaAgencyGrant[] {
  if (module !== 'agency_projects' || !level) return [];
  const reads = [
    grant('agency.projects.project.view.assigned', read),
    grant('agency.tasks.task.update.assigned', read),
    grant('agency.tasks.task.manage.department', read),
  ];
  if (level === 'viewer') return reads;
  const operator = [
    ...reads,
    grant('agency.tasks.task.create.assigned', ['POST']),
    grant('agency.tasks.task.update.assigned', ['PATCH', 'PUT', 'POST']),
    grant(
      'agency.tasks.task.update.assigned',
      ['DELETE'],
      level === 'operator' ? 'created_by_me' : 'client',
    ),
    grant(
      'agency.tasks.task.manage.department',
      ['DELETE'],
      level === 'operator' ? 'created_by_me' : 'client',
    ),
  ];
  if (level === 'operator') return operator;
  return [
    ...operator,
    grant('agency.tasks.task.manage.department', ['POST', 'PATCH', 'PUT']),
    grant('agency.projects.project.create.department', ['POST']),
    grant('agency.projects.project.update.department', [
      'PATCH',
      'PUT',
      'POST',
    ]),
    grant('agency.projects.project.archive.own', ['DELETE', 'POST', 'PATCH']),
    grant('agency.projects.project.archive.department', [
      'DELETE',
      'POST',
      'PATCH',
    ]),
  ];
}

/** Mutation keys reused by read endpoints must not advertise editing rights to a Viewer. */
export function clientAreaUiPermissions(
  access: ClientAreaMemberAccess,
): string[] {
  const keys = new Set<string>();
  for (const [module, state] of Object.entries(access)) {
    if (!state.available) continue;
    for (const entry of projectAgencyPermissions(
      module as ClientAreaModuleKey,
      state.level,
    )) {
      if (state.level !== 'viewer' || entry.key.includes('.view.'))
        keys.add(entry.key);
    }
  }
  return [...keys].sort();
}
