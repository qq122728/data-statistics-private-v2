export interface VerifyMigrationChecksumOptions {
  migrationsDirectory?: string;
  manifestPath?: string;
}

export interface MigrationChecksumResult {
  count: number;
  directory: string;
}

export const defaultMigrationsDirectory: string;
export const defaultManifestPath: string;
export function verifyMigrationChecksums(options?: VerifyMigrationChecksumOptions): MigrationChecksumResult;
