import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReputationReconciliationCheckpoints20261022000001
  implements MigrationInterface
{
  name = 'CreateReputationReconciliationCheckpoints20261022000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "reputation_reconciliation_checkpoints" (
        "worker_name" varchar(64) PRIMARY KEY,
        "last_confession_id" uuid,
        "status" varchar(16) NOT NULL DEFAULT 'idle',
        "processed_count" integer NOT NULL DEFAULT 0,
        "last_batch_size" integer NOT NULL DEFAULT 0,
        "last_error_code" varchar(64),
        "last_started_at" timestamptz,
        "last_completed_at" timestamptz,
        "updated_at" timestamptz NOT NULL DEFAULT now()
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TABLE IF EXISTS "reputation_reconciliation_checkpoints";',
    );
  }
}