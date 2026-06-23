import { Repository } from 'typeorm';
import {
  AgencyProject,
  AgencyProjectAttachment,
  AgencyProjectEvent,
  AgencyProjectFollower,
  AgencyTask,
} from '../entities';
import { ProjectsCrudService } from './projects-crud.service';

describe('ProjectsCrudService collection scoping', () => {
  it('scopes member project lists to owned, followed, or task-linked projects', async () => {
    const { service, queryBuilder } = makeService();

    await service.list(
      {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        role: 'member',
      },
      {},
    );

    const clauses = queryBuilder.scopeClauses.join('\n');
    expect(clauses).toContain('project.owner_id = :scopeUserId');
    expect(clauses).toContain('agency_project_followers');
    expect(clauses).toContain('agency_tasks');
  });

  it('does not add member collection scope for admin project lists', async () => {
    const { service, queryBuilder } = makeService();

    await service.list(
      {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'admin-1',
        role: 'admin',
      },
      {},
    );

    expect(queryBuilder.scopeClauses.join('\n')).not.toContain(
      'agency_project_followers',
    );
  });
});

function makeService() {
  const queryBuilder = createQueryBuilderMock<AgencyProject>();
  const projectsRepository = {
    createQueryBuilder: jest.fn(() => queryBuilder),
  };
  const eventsRepository = {
    create: jest.fn((value: Partial<AgencyProjectEvent>) => value),
    save: jest.fn(async (value: AgencyProjectEvent) => value),
  };

  const tasksRepository = {};
  const followersRepository = {};
  const attachmentsRepository = {};

  const service = new ProjectsCrudService(
    projectsRepository as unknown as Repository<AgencyProject>,
    eventsRepository as unknown as Repository<AgencyProjectEvent>,
    tasksRepository as unknown as Repository<AgencyTask>,
    followersRepository as unknown as Repository<AgencyProjectFollower>,
    attachmentsRepository as unknown as Repository<AgencyProjectAttachment>,
  );

  return { service, queryBuilder };
}

function createQueryBuilderMock<T>() {
  const scopeClauses: string[] = [];
  const bracketQb = {
    where: jest.fn((condition: string) => {
      scopeClauses.push(condition);
      return bracketQb;
    }),
    orWhere: jest.fn((condition: string) => {
      scopeClauses.push(condition);
      return bracketQb;
    }),
  };
  const qb = {
    scopeClauses,
    where: jest.fn(() => qb),
    andWhere: jest.fn((condition: unknown) => {
      if (
        condition &&
        typeof condition === 'object' &&
        'whereFactory' in condition &&
        typeof (condition as { whereFactory?: unknown }).whereFactory ===
          'function'
      ) {
        (condition as { whereFactory: (qb: typeof bracketQb) => void })
          .whereFactory(bracketQb);
      } else if (typeof condition === 'string') {
        scopeClauses.push(condition);
      }
      return qb;
    }),
    orderBy: jest.fn(() => qb),
    addOrderBy: jest.fn(() => qb),
    getMany: jest.fn().mockResolvedValue([] as T[]),
  };

  return qb;
}
