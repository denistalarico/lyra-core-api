import { readFileSync } from 'fs';
import { join } from 'path';
import { agencyEntities } from '../../config/typeorm.config';

/**
 * Every entity this module injects a repository for must be registered in
 * `agencyEntities`.
 *
 * Not a style rule — a boot failure. Both agency connections are configured with
 * `autoLoadEntities: false`, so `TypeOrmModule.forFeature([...])` declares an
 * intent that the datasource has no way to satisfy on its own: the entity has to
 * be in the array `typeorm.config.ts` exports, or `@InjectRepository` cannot
 * resolve and the whole application fails to start.
 *
 * The failure mode is what makes this worth a test. `forFeature` is the obvious
 * place to add an entity and the only one a module author touches, the second
 * registration lives in a 700-line file in another directory, and nothing in
 * between complains: typecheck passes, the unit tests pass (they construct
 * services by hand), and the migration runs. It surfaces at boot, on the first
 * environment that actually starts the app — which for this repository is a
 * deploy.
 *
 * Read from source rather than from the module's metadata because importing the
 * module pulls in its whole provider graph, and the `forFeature` list is the one
 * thing here that has to be checked against a *different* file.
 */
const MODULE_SOURCE = join(__dirname, 'social-integrations.module.ts');

function readFeatureEntities(): string[] {
  const source = readFileSync(MODULE_SOURCE, 'utf8');

  const featureBlock = /TypeOrmModule\.forFeature\(\s*\[([\s\S]*?)\]/.exec(
    source,
  );

  expect(featureBlock).not.toBeNull();

  return (
    (featureBlock?.[1] ?? '')
      // Comments inside the list explain why an entity joined; they are not names.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  );
}

describe('SocialIntegrationsModule entity registration', () => {
  it('registers every entity it injects in agencyEntities', () => {
    const registered = new Set(agencyEntities.map((entity) => entity.name));

    for (const entity of readFeatureEntities()) {
      expect(registered).toContain(entity);
    }
  });

  it('finds the entities it is meant to be checking', () => {
    // A guard on the guard: a regex that silently matched nothing would make the
    // assertion above vacuously true, which is the one way this test could fail
    // to do its job while passing.
    const entities = readFeatureEntities();

    expect(entities.length).toBeGreaterThanOrEqual(6);
    expect(entities).toContain('SocialAdReachPeriodEntity');
    expect(entities).toContain('SocialAdBreakdownDailyEntity');
  });
});
