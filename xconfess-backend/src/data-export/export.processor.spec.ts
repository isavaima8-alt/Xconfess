import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ExportProcessor } from './export.processor';
import { ExportRequest } from './entities/export-request.entity';
import { ExportChunk } from './entities/export-chunk.entity';
import { User } from '../user/entities/user.entity';
import { DataExportService } from './data-export.service';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';

describe('ExportProcessor', () => {
  let processor: ExportProcessor;
  let exportRepo: any;
  let chunkRepo: any;
  let userRepo: any;
  let dataExportService: any;

  beforeEach(async () => {
    exportRepo = {
      update: jest.fn(),
      findOneBy: jest.fn().mockResolvedValue(null),
    };
    chunkRepo = {
      save: jest.fn(),
      delete: jest.fn(),
    };
    userRepo = {
      findOneBy: jest.fn(),
    };
    dataExportService = {
      compileUserData: jest.fn(),
      convertToCsv: jest.fn(() => 'test,csv'),
      markExportFailed: jest.fn(),
      markExportProcessing: jest.fn().mockResolvedValue(true),
      isExportCancelled: jest.fn(async () => false), // Issue #106: cancellation check
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExportProcessor,
        {
          provide: getRepositoryToken(ExportRequest),
          useValue: exportRepo,
        },
        {
          provide: getRepositoryToken(ExportChunk),
          useValue: chunkRepo,
        },
        {
          provide: getRepositoryToken(User),
          useValue: userRepo,
        },
        {
          provide: DataExportService,
          useValue: dataExportService,
        },
        {
          provide: EmailService,
          useValue: { sendWelcomeEmail: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
      ],
    }).compile();

    processor = module.get<ExportProcessor>(ExportProcessor);
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  describe('handleExport', () => {
    it('should process a chunked export successfully', async () => {
      const mockJob = {
        name: 'process-export',
        data: { userId: '1', requestId: 'req-1' },
      } as Job;

      dataExportService.compileUserData.mockResolvedValue({
        userId: '1',
        confessions: [{ id: 1, message: 'hello' }],
      });
      userRepo.findOneBy.mockResolvedValue({
        id: 1,
        emailEncrypted: 'test@example.com',
        username: 'testuser',
      });

      await processor.process(mockJob);

      expect(dataExportService.compileUserData).toHaveBeenCalled();
      expect(dataExportService.markExportProcessing).toHaveBeenCalledWith(
        'req-1',
      );
      expect(exportRepo.update).toHaveBeenCalledWith(
        { id: 'req-1', status: 'PROCESSING' },
        expect.objectContaining({
          status: 'READY',
          isChunked: true,
        }),
      );
      expect(chunkRepo.save).toHaveBeenCalled();
    });

    it('should mark export as FAILED if error occurs', async () => {
      const mockJob = {
        name: 'process-export',
        data: { userId: '1', requestId: 'req-1' },
      } as Job;

      dataExportService.compileUserData.mockRejectedValue(
        new Error('Test error'),
      );

      await expect(processor.process(mockJob)).rejects.toThrow('Test error');

      expect(dataExportService.markExportProcessing).toHaveBeenCalledWith(
        'req-1',
      );
      expect(dataExportService.markExportFailed).toHaveBeenCalledWith(
        'req-1',
        'Test error',
      );
    });

    it('should not update status to READY when compilation fails', async () => {
      const mockJob = {
        name: 'process-export',
        data: { userId: '1', requestId: 'req-fail' },
      } as Job;

      dataExportService.compileUserData.mockRejectedValue(
        new Error('timeout'),
      );

      await expect(processor.process(mockJob)).rejects.toThrow('timeout');

      expect(exportRepo.update).not.toHaveBeenCalledWith(
        'req-fail',
        expect.objectContaining({ status: 'READY' }),
      );
      expect(dataExportService.markExportFailed).toHaveBeenCalledWith(
        'req-fail',
        'timeout',
      );
    });

    it('should call markExportFailed with error message on any failure', async () => {
      const mockJob = {
        name: 'process-export',
        data: { userId: '1', requestId: 'req-err' },
      } as Job;

      dataExportService.markExportProcessing.mockRejectedValue(
        new Error('DB connection lost'),
      );

      await expect(processor.process(mockJob)).rejects.toThrow(
        'DB connection lost',
      );

      expect(dataExportService.markExportFailed).toHaveBeenCalledWith(
        'req-err',
        'DB connection lost',
      );
    });

    it('should reject non-process-export job names', async () => {
      const mockJob = {
        name: 'other-job',
        data: { userId: '1', requestId: 'req-skip' },
      } as Job;

      await expect(processor.process(mockJob)).rejects.toThrow(
        'Unsupported export job name',
      );

      expect(dataExportService.markExportProcessing).not.toHaveBeenCalled();
      expect(dataExportService.markExportFailed).not.toHaveBeenCalled();
    });
  });
});
