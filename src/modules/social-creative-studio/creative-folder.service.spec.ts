import { BadRequestException, ConflictException } from '@nestjs/common';
import { CreativeFolderService } from './creative-folder.service';
import type { CreativeStudioScope } from './creative-studio.scope';
import type { CreativeAssetEntity, CreativeFolderEntity } from './entities';

const scope: CreativeStudioScope = {
  tenantId: 't',
  workspaceId: 'w',
  agencyClientId: 'c',
  companyContextId: 'co',
};
const folder = (id: string, parentId: string | null) =>
  ({ id, parentId, name: id.toUpperCase() }) as CreativeFolderEntity;

function harness(
  tree = [folder('a', null), folder('b', 'a'), folder('c', 'b')],
) {
  const removed: string[] = [];
  const manager = {
    transaction: jest.fn((run: (m: unknown) => unknown) => run(manager)),
    update: jest.fn(async () => ({ affected: 1 })),
    remove: jest.fn(async (item: CreativeFolderEntity) => {
      removed.push(item.id);
    }),
    find: jest.fn(async () => []),
    create: jest.fn((_: unknown, value: object) => value),
    save: jest.fn(async (value: object) => ({
      ...value,
      id: `copy-${(value as { name: string }).name}`,
    })),
  };
  const folders = {
    manager,
    find: jest.fn(async () => tree),
    findOne: jest.fn(
      async ({ where }: { where: { id: string } }) =>
        tree.find((item) => item.id === where.id) ?? null,
    ),
    save: jest.fn(async (value: CreativeFolderEntity) => value),
  };
  const assets = {
    count: jest.fn(async () => 0),
    find: jest.fn(async () => [] as CreativeAssetEntity[]),
    update: jest.fn(async () => ({ affected: 3 })),
  };
  return {
    service: new CreativeFolderService(folders as never, assets as never),
    folders,
    assets,
    manager,
    removed,
  };
}

describe('CreativeFolderService tree operations', () => {
  it('keeps the name of a Planner folder in step with the Planner', async () => {
    const linked = [
      { ...folder('p', null), socialPlanId: 'plan' },
      { ...folder('i', 'p'), contentItemId: 'item' },
      folder('x', null),
    ] as CreativeFolderEntity[];
    const h = harness(linked);
    (h.manager.find as jest.Mock)
      .mockResolvedValueOnce([{ id: 'plan', title: 'Novembro' }])
      .mockResolvedValueOnce([
        { id: 'item', title: 'Lançamento', plannedDate: '2026-11-15' },
      ]);
    const names = (await h.service.list(scope)).map((item) => item.name);
    expect(names).toEqual(['Novembro', '2026-11-15 · Lançamento', 'X']);
    await expect(h.service.update(scope, 'p', 'Outro')).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(h.service.update(scope, 'i', 'Outro')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(h.folders.save).not.toHaveBeenCalled();
  });

  it('refuses to move a folder inside itself or a descendant', async () => {
    const h = harness();
    await expect(h.service.move(scope, 'a', 'c')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(h.folders.save).not.toHaveBeenCalled();
  });

  it('moves a folder to the root', async () => {
    const h = harness();
    await expect(h.service.move(scope, 'b', null)).resolves.toMatchObject({
      id: 'b',
      parentId: null,
    });
  });

  it('archives the files of every level', async () => {
    const h = harness();
    await expect(h.service.archive(scope, 'a')).resolves.toEqual({
      archived: 3,
    });
    const calls = h.assets.update.mock.calls as unknown as [
      { folderId: { value: string[] } },
      { status: string },
    ][];
    expect(calls[0][0].folderId.value).toEqual(['a', 'b', 'c']);
    expect(calls[0][1].status).toBe('archived');
  });

  it('blocks deleting a tree with Planner-linked files', async () => {
    const h = harness();
    h.assets.count.mockResolvedValue(1);
    await expect(h.service.removeTree(scope, 'a')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(h.manager.remove).not.toHaveBeenCalled();
  });

  it('sends the files to the Lixeira, removing children first', async () => {
    const h = harness();
    await h.service.removeTree(scope, 'a');
    const update = h.manager.update.mock.calls[0] as unknown as [
      unknown,
      unknown,
      { folderId: null; trashedAt: Date; deletedAt?: Date },
    ];
    expect(update[2].folderId).toBeNull();
    expect(update[2].trashedAt).toBeInstanceOf(Date);
    expect(update[2].deletedAt).toBeUndefined();
    expect(h.removed).toEqual(['c', 'b', 'a']);
  });

  it('deletes the files right away when permanent', async () => {
    const h = harness();
    await h.service.removeTree(scope, 'a', true);
    const update = h.manager.update.mock.calls[0] as unknown as [
      unknown,
      unknown,
      { deletedAt?: Date },
    ];
    expect(update[2].deletedAt).toBeInstanceOf(Date);
  });

  it('rebuilds the hierarchy when copying, naming only the root as a copy', async () => {
    const h = harness();
    const copy = await h.service.copy(scope, 'user', 'a', null);
    expect(copy).toMatchObject({ id: 'copy-A - cópia', parentId: null });
    const created = h.manager.create.mock.calls.map(
      (call) =>
        (
          call as unknown as [
            unknown,
            { name: string; parentId: string | null },
          ]
        )[1],
    );
    expect(created.map((item) => [item.name, item.parentId])).toEqual([
      ['A - cópia', null],
      ['B', 'copy-A - cópia'],
      ['C', 'copy-B'],
    ]);
  });

  it('refuses to copy a folder into its own tree', async () => {
    const h = harness();
    await expect(
      h.service.copy(scope, 'user', 'a', 'b'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.manager.transaction).not.toHaveBeenCalled();
  });
});
