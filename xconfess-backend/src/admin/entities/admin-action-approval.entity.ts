import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum AdminCriticalAction {
  CONFESSION_DELETE = 'confession.delete',
}

export enum AdminActionApprovalStatus {
  PENDING = 'pending',
  EXECUTED = 'executed',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

@Entity('admin_action_approvals')
@Index(['status', 'expiresAt'])
@Index(['requestedById', 'requestedAt'])
export class AdminActionApproval {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64 })
  action: AdminCriticalAction;

  @Column({ name: 'target_id', type: 'varchar', length: 128 })
  targetId: string;

  @Column({ name: 'requested_by_id', type: 'int' })
  requestedById: number;

  @Column({ name: 'approved_by_id', type: 'int', nullable: true })
  approvedById: number | null;

  @Column({ type: 'varchar', length: 16, default: AdminActionApprovalStatus.PENDING })
  status: AdminActionApprovalStatus;

  @Column({ type: 'text' })
  reason: string;

  @Column({ name: 'cancellation_reason', type: 'text', nullable: true })
  cancellationReason: string | null;

  @CreateDateColumn({ name: 'requested_at', type: 'timestamptz' })
  requestedAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'executed_at', type: 'timestamptz', nullable: true })
  executedAt: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ name: 'expired_at', type: 'timestamptz', nullable: true })
  expiredAt: Date | null;
}
