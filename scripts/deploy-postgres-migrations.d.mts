export function migrationDatabaseUrl(
  databaseUrl: string | undefined,
  environment?: Record<string, string | undefined>,
): string;

export function deployPostgresMigrations(options?: {
  environment?: Record<string, string | undefined>;
  spawn?: (...args: any[]) => any;
}): number;
