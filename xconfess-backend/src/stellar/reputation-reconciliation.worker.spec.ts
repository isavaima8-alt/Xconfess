import { Logger } from '@nestjs/common';
import { ReputationReconciliationWorker } from './reputation-reconciliation.worker';
import { ReputationReconciliationCheckpoint } from './entities/reputation-reconciliation-checkpoint.entity';
import { TipVerificationStatus } from '../tipping/entities/tip.entity';

describe('ReputationReconciliationWorker', () => {
  let worker: ReputationReconciliationWorker;
  let tipRepository: any;
  let confessionRepository: any;
  let checkpointRepository: any;
  let configService: any;
  let eventEmitter: any;
  let rawRows: Array<{ id: string }>;
  let queryBuilder: any;

  beforeEach(() => {
    rawRows = [];
    queryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockImplementation(async () => rawRows),
    };
    tipRepository = { find: jest.fn().mockResolvedValue([]) };
    confessionRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };
    checkpointRepository = {
      findOne: jest.fn(),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    configService = {
      get: jest.fn((key, fallback) => {
        if (key === 'ENABLE_BACKGROUND_JOBS') return 'true';
        if (key === 'REPUTATION_RECONCILIATION_BATCH_SIZE') return '2';
        return fallback;
      }),
    };
    eventEmitter = { emit: jest.fn() };
    worker = new ReputationReconciliationWorker(
      tipRepository,
      confessionRepository,
      checkpointRepository,
      configService,
      eventEmitter,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('does not access data or scan unless background jobs are explicitly enabled', async () => {
    configService.get.mockImplementation((key, fallback) =>
      key === 'ENABLE_BACKGROUND_JOBS' ? 'false' : fallback,
    );

    await worker.reconcileReputationScores();

    expect(checkpointRepository.findOne).not.toHaveBeenCalled();
    expect(confessionRepository.createQueryBuilder).not.toHaveBeenCalled();
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'reputation.reconciliation.progress',
      expect.objectContaining({ status: 'skipped', reason: 'background_jobs_disabled' }),
    );
  });

  it('resumes after the persisted cursor and marks the scan complete at the end', async () => {
    const checkpoint = {
      workerName: 'reputation-reconciliation',
      lastConfessionId: null,
      status: 'idle',
      processedCount: 0,
      lastBatchSize: 0,
      lastErrorCode: null,
      lastStartedAt: null,
      lastCompletedAt: null,
    } as ReputationReconciliationCheckpoint;
    checkpointRepository.findOne.mockResolvedValue(checkpoint);
    rawRows = [{ id: 'confession-a' }, { id: 'confession-b' }];

    await worker.reconcileReputationScores();

    expect(queryBuilder.where).toHaveBeenCalledWith(
      't.verification_status = :status',
      { status: TipVerificationStatus.VERIFIED },
    );
    expect(queryBuilder.orderBy).toHaveBeenCalledWith('c.id', 'ASC');
    expect(queryBuilder.limit).toHaveBeenCalledWith(2);
    expect(checkpoint.lastConfessionId).toBe('confession-b');
    expect(checkpoint.status).toBe('in_progress');
    expect(checkpoint.processedCount).toBe(2);

    queryBuilder.andWhere.mockClear();
    rawRows = [{ id: 'confession-c' }];
    await worker.reconcileReputationScores();

    expect(queryBuilder.andWhere).toHaveBeenCalledWith('c.id > :lastConfessionId', {
      lastConfessionId: 'confession-b',
    });
    expect(checkpoint.lastConfessionId).toBeNull();
    expect(checkpoint.status).toBe('complete');
    expect(checkpoint.processedCount).toBe(3);
  });

  it('leaves the cursor unchanged on batch failure and reports only a generic error code', async () => {
    const checkpoint = {
      workerName: 'reputation-reconciliation',
      lastConfessionId: 'confession-before-batch',
      status: 'in_progress',
      processedCount: 4,
      lastBatchSize: 2,
      lastErrorCode: null,
      lastStartedAt: null,
      lastCompletedAt: null,
    } as ReputationReconciliationCheckpoint;
    checkpointRepository.findOne.mockResolvedValue(checkpoint);
    rawRows = [{ id: 'confession-private-id' }];
    tipRepository.find.mockRejectedValue(new Error('private database detail'));
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    await expect(worker.reconcileReputationScores()).rejects.toThrow(
      'BATCH_PROCESSING_FAILED',
    );

    expect(checkpoint.lastConfessionId).toBe('confession-before-batch');
    expect(checkpoint.status).toBe('failed');
    expect(checkpoint.lastErrorCode).toBe('BATCH_PROCESSING_FAILED');
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'reputation.reconciliation.failure',
      expect.objectContaining({ errorCode: 'BATCH_PROCESSING_FAILED' }),
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('private database detail');
    expect(JSON.stringify(eventEmitter.emit.mock.calls)).not.toContain('confession-private-id');
  });
});