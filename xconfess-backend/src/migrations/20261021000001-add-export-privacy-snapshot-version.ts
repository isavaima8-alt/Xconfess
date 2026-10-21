import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExportPrivacySnapshotVersion20261021000001 implements MigrationInterface {
  name = 'AddExportPrivacySnapshotVersion20261021000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('export_requests'))) {
      return;
    }

    await queryRunner.query(`
      ALTER TABLE "export_requests"
        ADD COLUMN IF NOT EXISTS "privacySnapshotVersion" VARCHAR(64) NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "export_requests"
        DROP COLUMN IF EXISTS "privacySnapshotVersion";
    `);
  }
}