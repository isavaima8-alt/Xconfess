import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdminActionApprovals20261022000002
  implements MigrationInterface
{
  name = 'CreateAdminActionApprovals20261022000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "admin_action_approvals" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "action" varchar(64) NOT NULL,
        "target_id" varchar(128) NOT NULL,
        "requested_by_id" integer NOT NULL,
        "approved_by_id" integer,
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "reason" text NOT NULL,
        "cancellation_reason" text,
        "requested_at" timestamptz NOT NULL DEFAULT now(),
        "expires_at" timestamptz NOT NULL,
        "approved_at" timestamptz,
        "executed_at" timestamptz,
        "cancelled_at" timestamptz,
        "expired_at" timestamptz,
        CONSTRAINT "CHK_admin_action_approvals_action"
          CHECK ("action" = 'confession.delete'),
        CONSTRAINT "CHK_admin_action_approvals_status"
          CHECK ("status" IN ('pending', 'executed', 'cancelled', 'expired')),
        CONSTRAINT "CHK_admin_action_approvals_approver"
          CHECK ("approved_by_id" IS NULL OR "approved_by_id" <> "requested_by_id")
      );
      CREATE INDEX "IDX_admin_action_approvals_status_expiry"
        ON "admin_action_approvals" ("status", "expires_at");
      CREATE INDEX "IDX_admin_action_approvals_requester_created"
        ON "admin_action_approvals" ("requested_by_id", "requested_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "admin_action_approvals";');
  }
}
