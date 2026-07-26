import { Repository } from 'typeorm';
import { AgencyActivityLink } from '../../activities/entities';
import { TeamConfigOption } from '../../team/entities';
import {
  AgencyClient,
  ClientLifecycleProcess,
  ClientLifecycleStep,
} from '../entities';
import {
  ClientLifecycleProcessStatus,
  ClientLifecycleProcessType,
} from '../enums';
import { ClientLifecycleService } from './client-lifecycle.service';
import { ClientNotificationPublisher } from './client-notification.publisher';

describe('ClientLifecycleService conflicting processes', () => {
  const context = {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    userId: 'user-1',
  };

  function makeService() {
    const configOptionRepository = {
      findOne: jest.fn(),
    };
    const processRepository = {
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
    };
    const service = new ClientLifecycleService(
      {} as Repository<AgencyClient>,
      configOptionRepository as unknown as Repository<TeamConfigOption>,
      processRepository as unknown as Repository<ClientLifecycleProcess>,
      {} as Repository<ClientLifecycleStep>,
      {} as Repository<AgencyActivityLink>,
      {} as ClientNotificationPublisher,
    );

    return { service, configOptionRepository, processRepository };
  }

  function makeConflictingProcess(
    processType: ClientLifecycleProcessType,
  ): ClientLifecycleProcess {
    return {
      id: 'process-1',
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      clientId: 'client-1',
      processType,
      status: ClientLifecycleProcessStatus.InProgress,
      templateConfigOptionId: null,
      lostReasonId: null,
      startedAt: new Date(),
      completedAt: null,
      createdById: context.userId,
      updatedById: context.userId,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  it('blocks onboarding while offboarding is in progress', async () => {
    const { service, processRepository } = makeService();
    processRepository.findOne.mockResolvedValue(
      makeConflictingProcess(ClientLifecycleProcessType.Offboarding),
    );

    await expect(
      service.startLifecycle(
        context,
        'client-1',
        ClientLifecycleProcessType.Onboarding,
        {},
      ),
    ).rejects.toThrow(
      'Conclua ou cancele o offboarding em andamento antes de iniciar outro processo.',
    );
    expect(processRepository.save).not.toHaveBeenCalled();
  });

  it('blocks applying an offboarding template while onboarding is in progress', async () => {
    const { service, processRepository } = makeService();
    processRepository.findOne.mockResolvedValue(
      makeConflictingProcess(ClientLifecycleProcessType.Onboarding),
    );

    await expect(
      service.applyTemplate(
        context,
        'client-1',
        ClientLifecycleProcessType.Offboarding,
        'template-1',
      ),
    ).rejects.toThrow(
      'Conclua ou cancele o onboarding em andamento antes de iniciar outro processo.',
    );
    expect(processRepository.save).not.toHaveBeenCalled();
  });

  it('rejects a saved template from the opposite process type', async () => {
    const { service, configOptionRepository, processRepository } =
      makeService();
    const onboardingProcess = makeConflictingProcess(
      ClientLifecycleProcessType.Onboarding,
    );
    processRepository.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(onboardingProcess);
    configOptionRepository.findOne.mockResolvedValue({
      id: 'template-1',
      type: 'client_offboarding_template',
      metadata: { steps: [] },
    });

    await expect(
      service.applyTemplate(
        context,
        'client-1',
        ClientLifecycleProcessType.Onboarding,
        'template-1',
      ),
    ).rejects.toThrow('O modelo não pertence a este processo.');
    expect(processRepository.save).not.toHaveBeenCalled();
  });
});
