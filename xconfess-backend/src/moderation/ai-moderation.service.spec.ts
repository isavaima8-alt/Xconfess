import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  AiModerationService,
  ModerationStatus,
} from './ai-moderation.service';

describe('AiModerationService', () => {
  function createService(
    overrides: Record<string, unknown> = {},
    appLogger?: { incrementCounter: jest.Mock },
  ) {
    const config = {
      OPENAI_API_KEY: '',
      PERSPECTIVE_API_KEY: '',
      MODERATION_HIGH_THRESHOLD: 0.8,
      MODERATION_MEDIUM_THRESHOLD: 0.5,
      AUTO_ACTION_ENABLED: true,
      ENABLED_MODERATION_CATEGORIES:
        'hate_speech,harassment,self_harm,violence,sexual,spam',
      ...overrides,
    };

    return new AiModerationService({
      get: jest.fn((key: string, defaultValue?: unknown) =>
        key in config ? config[key] : defaultValue,
      ),
    } as unknown as ConfigService, appLogger as any);
  }

  it('returns configuration from defaults', () => {
    const service = createService();

    expect(service.getConfiguration()).toMatchObject({
      highThreshold: 0.8,
      mediumThreshold: 0.5,
      autoActionEnabled: true,
    });
  });

  it('falls back to rule-based moderation without API keys', async () => {
    const service = createService();

    const result = await service.moderateContent('a calm confession');

    expect(result.status).toBe(ModerationStatus.APPROVED);
    expect(result.requiresReview).toBe(false);
  });

  it('retries a transient scoring failure within the configured budget', async () => {
    const appLogger = { incrementCounter: jest.fn() };
    const service = createService(
      { OPENAI_API_KEY: 'test-key', MODERATION_PROVIDER_MAX_ATTEMPTS: 2 },
      appLogger,
    );
    const post = jest
      .spyOn(axios, 'post')
      .mockRejectedValueOnce(new axios.AxiosError('timeout', 'ECONNABORTED'))
      .mockResolvedValueOnce({
        data: {
          results: [{ categories: {}, category_scores: {} }],
        },
      } as any);

    try {
      await service.moderateContent('private moderation input');

      expect(post).toHaveBeenCalledTimes(2);
      expect(appLogger.incrementCounter).toHaveBeenCalledWith(
        'moderation_provider_attempt_total',
        1,
        { provider: 'openai', outcome: 'retry' },
      );
      expect(appLogger.incrementCounter).toHaveBeenCalledWith(
        'moderation_provider_attempt_total',
        1,
        { provider: 'openai', outcome: 'success' },
      );
    } finally {
      post.mockRestore();
    }
  });

  it('does not retry a permanent provider response', async () => {
    const appLogger = { incrementCounter: jest.fn() };
    const service = createService({ OPENAI_API_KEY: 'test-key' }, appLogger);
    const unauthorized = Object.assign(new Error('unauthorized'), {
      isAxiosError: true,
      response: { status: 401 },
    });
    const post = jest.spyOn(axios, 'post').mockRejectedValue(unauthorized);

    try {
      await service.moderateContent('private moderation input');

      expect(post).toHaveBeenCalledTimes(1);
      expect(appLogger.incrementCounter).toHaveBeenCalledWith(
        'moderation_provider_attempt_total',
        1,
        { provider: 'openai', outcome: 'terminal' },
      );
    } finally {
      post.mockRestore();
    }
  });

  it('applies only valid runtime thresholds', () => {
    const service = createService();
    service.updateThresholds(0.9, 0.7);

    expect(service.getConfiguration()).toMatchObject({
      highThreshold: 0.9,
      mediumThreshold: 0.7,
    });
    expect(() => service.updateThresholds(0.6, 0.7)).toThrow(
      BadRequestException,
    );
    expect(service.getConfiguration()).toMatchObject({
      highThreshold: 0.9,
      mediumThreshold: 0.7,
    });
  });
});
