import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function routeSource(name: string) {
  return readFileSync(join(process.cwd(), "src/app/api/admin", name, "route.ts"), "utf8");
}

function postSection(source: string) {
  const start = source.indexOf("export async function POST");
  const end = source.indexOf("export async function PATCH", start);
  return source.slice(start, end === -1 ? undefined : end);
}

function patchSection(source: string) {
  return source.slice(source.indexOf("export async function PATCH"));
}

describe("admin parent-state transaction boundaries", () => {
  it("performs every create/update parent check through the transaction client", () => {
    const groupPost = postSection(routeSource("groups"));
    expect(groupPost).not.toContain("db.department.findFirst");
    expect(groupPost.indexOf("client.department.findFirst")).toBeGreaterThan(groupPost.indexOf("db.$transaction"));
    expect(groupPost).toContain('isolationLevel: "Serializable"');

    const channelPost = postSection(routeSource("channels"));
    expect(channelPost).not.toContain("db.teamGroup.findFirst");
    expect(channelPost.indexOf("client.teamGroup.findFirst")).toBeGreaterThan(channelPost.indexOf("db.$transaction"));
    expect(channelPost).toContain('isolationLevel: "Serializable"');

    const users = routeSource("users");
    const userPost = postSection(users);
    expect(userPost.indexOf("hasValidOrganizationScope(role, groupId, departmentId, managementCountryCode, client)")).toBeGreaterThan(userPost.indexOf("db.$transaction"));
    expect(userPost).toContain('isolationLevel: "Serializable"');

    const userPatch = patchSection(users);
    expect(userPatch.indexOf("hasValidOrganizationScope(nextRole, nextGroupId, nextDepartmentId, nextManagementCountryCode, client)")).toBeGreaterThan(userPatch.indexOf("db.$transaction"));
    expect(userPatch).toContain('isolationLevel: "Serializable"');
  });
});
