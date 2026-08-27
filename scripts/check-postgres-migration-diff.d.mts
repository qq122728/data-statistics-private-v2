export function forbiddenMigrationChanges(output: string): string[];
export function checkMigrationDiff(
  baseRef: string,
  options?: { spawn?: (...args: any[]) => any },
): boolean;
