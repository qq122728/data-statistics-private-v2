import { Prisma as DefaultPrisma } from "@prisma/client";
import { Prisma as SqlitePrisma } from "../../node_modules/.prisma/sqlite-migration-client";
import { Prisma as PostgresPrisma } from "../../node_modules/.prisma/postgres-migration-client";

// Each generated client owns its error constructor. Recognize all supported clients,
// including the default client used by standalone tools and existing tests.
export function isKnownPrismaError(error: unknown): error is DefaultPrisma.PrismaClientKnownRequestError {
  return error instanceof DefaultPrisma.PrismaClientKnownRequestError
    || error instanceof SqlitePrisma.PrismaClientKnownRequestError
    || error instanceof PostgresPrisma.PrismaClientKnownRequestError;
}
