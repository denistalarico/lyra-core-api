import {
  ANY_PERMISSION_KEYS_METADATA,
  DANGEROUS_ACTION_METADATA,
  PERMISSION_KEY_METADATA,
} from '../../permissions/decorators/permissions.decorators';
import { ProjectsCrudController } from './projects-crud.controller';

describe('CA9 authorized project archival reclassification', () => {
  it('keeps Agency archival permissions while removing the dangerous classification', () => {
    const handler = Reflect.get(
      ProjectsCrudController.prototype,
      'archive',
    ) as object;
    expect(
      Reflect.getMetadata(DANGEROUS_ACTION_METADATA, handler),
    ).toBeUndefined();
    expect(Reflect.getMetadata(ANY_PERMISSION_KEYS_METADATA, handler)).toEqual([
      'agency.projects.project.archive.department',
      'agency.projects.project.archive.own',
    ]);
  });

  it('keeps permanent deletion dangerous and restricted to Agency Owner', () => {
    const handler = Reflect.get(
      ProjectsCrudController.prototype,
      'remove',
    ) as object;
    expect(Reflect.getMetadata(DANGEROUS_ACTION_METADATA, handler)).toBe(true);
    expect(Reflect.getMetadata(PERMISSION_KEY_METADATA, handler)).toBe(
      'agency.projects.project.delete.owner_only',
    );
  });
});
