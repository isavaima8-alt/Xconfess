import {
  Column,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('reputation_reconciliation_checkpoints')
export class ReputationReconciliationCheckpoint {
  @PrimaryColumn({ name: 'worker_name', type: 'varchar', length: 64 })
  workerName!: string;

  @Column({ name: 'last_confession_id', type: 'uuid', nullable: true })
  lastConfessionId!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'idle' })
  status!: 'idle' | 'running' | 'in_progress' | 'complete' | 'failed';

  @Column({ name: 'processed_count', type: 'integer', default: 0 })
  processedCount!: number;

  @Column({ name: 'last_batch_size', type: 'integer', default: 0 })
  lastBatchSize!: number;

  @Column({ name: 'last_error_code', type: 'varchar', length: 64, nullable: true })
  lastErrorCode!: string | null;

  @Column({ name: 'last_started_at', type: 'timestamptz', nullable: true })
  lastStartedAt!: Date | null;

  @Column({ name: 'last_completed_at', type: 'timestamptz', nullable: true })
  lastCompletedAt!: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}