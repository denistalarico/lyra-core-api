import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { getPermissionDefinition } from '../permissions/catalog/permission-keys.catalog';
import { CLIENT_AREA_MODULE_KEYS } from './client-area.types';
import { projectAgencyPermissions } from './client-area-agency-permission-projection';

const digest = (value: string) =>
  createHash('sha256').update(value.trim()).digest('hex');
describe('CA7 production route boundaries and Agency preservation', () => {
  it('keeps the Agency PermissionsGuard body byte-for-byte after the isolated dispatch', () => {
    const source = readFileSync(
      resolve(__dirname, '../permissions/guards/permissions.guard.ts'),
      'utf8',
    );
    const method = source
      .slice(
        source.indexOf('  async canActivate('),
        source.indexOf('  private async authorizeClientArea'),
      )
      .replace(
        /\n\n {4}if \(user\?\.surface === 'client_area'\)\n {6}return this\.authorizeClientArea\(executionContext, request\);/,
        '',
      );
    expect(digest(method)).toBe(
      '215cd01b8fc4f0c24ea0d7b8640df2dd19fb0053e6646f6c1499f3e4eca7898f',
    );
  });
  it('keeps every existing Agency scope evaluator method byte-for-byte', () => {
    const source = readFileSync(
      resolve(
        __dirname,
        '../permissions/services/permission-scope-evaluator.service.ts',
      ),
      'utf8',
    );
    expect(digest(source.slice(source.indexOf('  async assertScope(')))).toBe(
      'a67a3bed34a180f20dca3e10e143082bab9ad5970fe7e9c28e13f8eed4ec03c9',
    );
  });
  it('projects only real, non-dangerous keys and no workspace configuration or automations', () => {
    for (const module of CLIENT_AREA_MODULE_KEYS)
      for (const level of ['viewer', 'operator', 'manager'] as const)
        for (const entry of projectAgencyPermissions(module, level)) {
          expect(getPermissionDefinition(entry.key)).toBeDefined();
          expect(getPermissionDefinition(entry.key)?.isDangerous).toBe(false);
          expect(entry.key).not.toMatch(
            /owner_only|danger_zone|settings.users|automations|stages.manage/,
          );
        }
  });
  it('snapshots production opt-ins and rejects unguarded, dangerous or automation routes', () => {
    const root = resolve(__dirname, '..');
    const exposed: string[] = [];
    const decorators = (node: ts.Node) =>
      ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
    const names = (node: ts.Node) =>
      decorators(node).map((d) =>
        ts.isCallExpression(d.expression)
          ? d.expression.expression.getText()
          : d.expression.getText(),
      );
    for (const relative of readdirSync(root, {
      recursive: true,
      encoding: 'utf8',
    }).filter((file) => file.endsWith('.controller.ts'))) {
      const source = ts.createSourceFile(
        relative,
        readFileSync(resolve(root, relative), 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      for (const item of source.statements)
        if (ts.isClassDeclaration(item)) {
          expect(names(item)).not.toContain('ClientAreaExposed');
          for (const method of item.members)
            if (names(method).includes('ClientAreaExposed')) {
              const effective = [...names(item), ...names(method)];
              expect(
                effective.some((n) =>
                  ['RequirePermission', 'RequireAnyPermission'].includes(n),
                ),
              ).toBe(true);
              expect(effective).not.toContain('DangerousAction');
              expect(relative).not.toMatch(/automations/);
              exposed.push(`${relative}:${method.name?.getText()}`);
            }
        }
    }
    expect(exposed.sort()).toMatchInlineSnapshot(`[]`);
  });
});
