import { AppLogger } from './logger.service';

describe('AppLogger', () => {
  let service: AppLogger;

  beforeEach(() => {
    service = new AppLogger();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should mask user ids inside object payloads', () => {
    const payload = { userId: '1234567890abcdef', action: 'test' };
    const sanitized = (service as any).sanitize(payload);

    expect(sanitized).toEqual(
      expect.objectContaining({
        userId: expect.any(String),
        action: 'test',
      }),
    );
    expect(sanitized.userId).not.toBe(payload.userId);
  });

  it('redacts a Stellar secret seed embedded in a string message (#1472)', () => {
    const secret = 'S' + 'B'.repeat(55);
    const sanitized = (service as any).sanitize(`signing failed: ${secret}`);

    expect(sanitized).not.toContain(secret);
  });

  it('fully redacts fields whose key name indicates a secret, regardless of nesting (#1472)', () => {
    const payload = {
      event: 'stellar_error',
      details: { serverSecret: 'SCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC' },
    };
    const sanitized = (service as any).sanitize(payload);

    expect(sanitized.details.serverSecret).toBe('[REDACTED]');
  });

  it('restricts metric labels to the approved low-cardinality vocabulary', () => {
    service.incrementCounter('notification_queue_enqueued_total', 1, {
      queue: 'notifications',
      notificationType: 'user-1234',
      userId: '1234',
    });

    expect(service.getMetricsSnapshot().counters[0]).toMatchObject({
      labels: {
        notificationType: 'other',
        queue: 'notifications',
      },
    });
    expect(JSON.stringify(service.getMetricsSnapshot())).not.toContain('1234');
  });

  it('restricts metric labels to the approved low-cardinality vocabulary', () => {
    service.incrementCounter('notification_queue_enqueued_total', 1, {
      queue: 'notifications',
      notificationType: 'user-1234',
      userId: '1234',
    });

    expect(service.getMetricsSnapshot().counters[0]).toMatchObject({
      labels: {
        notificationType: 'other',
        queue: 'notifications',
      },
    });
    expect(JSON.stringify(service.getMetricsSnapshot())).not.toContain('1234');
  });
});
