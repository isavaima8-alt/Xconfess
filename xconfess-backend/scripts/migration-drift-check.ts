import 'reflect-metadata';
import { MigrationVerificationService } from '../src/database/migration-verification.service';

async function main(): Promise<void> {
  if (process.env.MIGRATION_GATE_DATABASE_CHECK !== 'true') {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        queryError: 'Set MIGRATION_GATE_DATABASE_CHECK=true to authorize the database check.',
      }),
    );
    process.exitCode = 2;
    return;
  }

  let dataSource: typeof import('../data-source').default | undefined;
  try {
    ({ default: dataSource } = await import('../data-source'));
    dataSource.setOptions({
      synchronize: false,
      migrationsRun: false,
      extra: {
        ...dataSource.options.extra,
        options: '-c default_transaction_read_only=on',
      },
    });
    await dataSource.initialize();
    const result = await new MigrationVerificationService(dataSource).checkMigrationDrift();
    process.stdout.write(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  } catch {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        queryError:
          'Database drift check failed. Verify read-only database access and connectivity; detailed errors are suppressed.',
      }),
    );
    process.exitCode = 1;
  } finally {
    if (dataSource?.isInitialized) await dataSource.destroy();
  }
}

void main();
