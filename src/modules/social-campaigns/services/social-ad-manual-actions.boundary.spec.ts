import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.resolve(__dirname, '..');
const service = fs.readFileSync(
  path.join(__dirname, 'social-ad-manual-action.service.ts'),
  'utf8',
);
const adapter = fs.readFileSync(
  path.join(__dirname, 'meta-ads-manual-action.adapter.ts'),
  'utf8',
);
const googleAdapter = fs.readFileSync(
  path.join(__dirname, 'google-ads-manual-action.adapter.ts'),
  'utf8',
);
const controller = fs.readFileSync(
  path.join(root, 'social-campaigns.controller.ts'),
  'utf8',
);

describe('manual Meta action boundary', () => {
  it('has no LLM, recommendation, rule engine or scheduler execution path', () => {
    expect(service).toContain('recommendationsCanExecute: false');
    const source = `${service}\n${adapter}\n${googleAdapter}`.replace(
      'recommendationsCanExecute: false',
      '',
    );
    expect(source).not.toMatch(
      /recommendation|openai|llm|scheduler|cron|rule.engine/i,
    );
  });

  it('requires separate preflight and confirm routes for every write', () => {
    for (const route of ['status', 'budget', 'schedule', 'delete']) {
      expect(controller).toContain(`meta/actions/${route}/preflight`);
      expect(controller).toContain(`meta/actions/${route}/:actionId/confirm`);
    }
    expect(controller).toContain('@DangerousAction()');
  });

  it('requires separate preflight and confirm routes for every Google write (GA-WRITE)', () => {
    for (const route of [
      'status',
      'budget',
      'negative_keyword',
      'keyword',
      'search_theme',
    ]) {
      expect(controller).toContain(`google/actions/${route}/preflight`);
      expect(controller).toContain(`google/actions/${route}/:actionId/confirm`);
    }
  });

  it('does not write the local SocialAdEntity mirror after provider execution', () => {
    expect(service).not.toMatch(/entities\.(save|update|delete|remove)/);
    expect(service).toContain('read model');
  });
});
