import { Repository } from 'typeorm';
import {
  AgencyPersonalTaskStage,
  AgencyProject,
  AgencyProjectStage,
  AgencyTask,
  AgencyTaskStage,
} from '../entities';
import { ProjectBoardsService } from './project-boards.service';

type PersonalBoard = {
  columns: Array<{
    id: string;
    cards: AgencyTask[];
  }>;
  unassigned: {
    cards: AgencyTask[];
  };
};

type PersonalBoardBuilder = {
  buildPersonalTasksBoard(
    stages: AgencyPersonalTaskStage[],
    tasks: AgencyTask[],
  ): PersonalBoard;
};

describe('ProjectBoardsService personal task stages', () => {
  it('shows tasks without a valid personal stage in the first configured stage', () => {
    const service = makeService();
    const stages = [
      makeStage({ id: 'stage-first', position: 0 }),
      makeStage({ id: 'stage-second', position: 1 }),
    ];
    const unstagedTask = makeTask({
      id: 'task-unstaged',
      personalStageId: null,
    });
    const invalidStageTask = makeTask({
      id: 'task-invalid',
      personalStageId: 'removed-stage',
    });
    const secondStageTask = makeTask({
      id: 'task-second',
      personalStageId: 'stage-second',
    });

    const board = getPersonalBoardBuilder(service).buildPersonalTasksBoard(
      stages,
      [unstagedTask, invalidStageTask, secondStageTask],
    );

    expect(board.columns[0].cards).toEqual([unstagedTask, invalidStageTask]);
    expect(board.columns[1].cards).toEqual([secondStageTask]);
    expect(board.unassigned.cards).toEqual([]);
  });

  it('keeps tasks unassigned when no personal stage is configured', () => {
    const service = makeService();
    const task = makeTask({ id: 'task-unstaged', personalStageId: null });

    const board = getPersonalBoardBuilder(service).buildPersonalTasksBoard(
      [],
      [task],
    );

    expect(board.columns).toEqual([]);
    expect(board.unassigned.cards).toEqual([task]);
  });
});

function makeService() {
  return new ProjectBoardsService(
    {} as Repository<AgencyProject>,
    {} as Repository<AgencyProjectStage>,
    {} as Repository<AgencyTask>,
    {} as Repository<AgencyTaskStage>,
    {} as Repository<AgencyPersonalTaskStage>,
  );
}

function getPersonalBoardBuilder(
  service: ProjectBoardsService,
): PersonalBoardBuilder {
  return service as unknown as PersonalBoardBuilder;
}

function makeStage(
  overrides: Partial<AgencyPersonalTaskStage> = {},
): AgencyPersonalTaskStage {
  return {
    id: 'stage-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    name: 'Etapa',
    color: null,
    position: 0,
    isDefault: false,
    createdAt: new Date('2026-07-26T12:00:00.000Z'),
    updatedAt: new Date('2026-07-26T12:00:00.000Z'),
    ...overrides,
  };
}

function makeTask(overrides: Partial<AgencyTask> = {}): AgencyTask {
  return {
    id: 'task-1',
    personalStageId: null,
    ...overrides,
  } as AgencyTask;
}
