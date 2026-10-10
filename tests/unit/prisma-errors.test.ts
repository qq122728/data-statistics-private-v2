import { expect, it } from "vitest";
import { Prisma as DefaultPrisma } from "@prisma/client";
import { Prisma as SqlitePrisma } from "../../node_modules/.prisma/sqlite-migration-client";
import { Prisma as PostgresPrisma } from "../../node_modules/.prisma/postgres-migration-client";
import { isKnownPrismaError } from "../../src/lib/prisma-errors";

it.each([DefaultPrisma, SqlitePrisma, PostgresPrisma])("recognizes generated client errors", Prisma => {
  const error = new Prisma.PrismaClientKnownRequestError("conflict", { code: "P2003", clientVersion: "test" });
  expect(isKnownPrismaError(error)).toBe(true);
  expect(error.code).toBe("P2003");
});
it("does not swallow unrelated errors or code-shaped plain objects", () => {
  for (const error of [new Error("other"), { code: "P2003" }, null]) expect(isKnownPrismaError(error)).toBe(false);
});
