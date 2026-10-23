export const QUEUE_WORKER_CONCURRENCY = {
  notifications: Number(process.env.NOTIFICATION_WORKER_CONCURRENCY ?? 5),
  'export-queue': Number(process.env.EXPORT_WORKER_CONCURRENCY ?? 1),
  'confession-draft-publisher': Number(
    process.env.CONFESSION_DRAFT_WORKER_CONCURRENCY ?? 1,
  ),
} as const;
