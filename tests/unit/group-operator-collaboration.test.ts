import { describe, expect, it } from "vitest";
import { resolveAccessibleReceptionistIds } from "../../src/lib/group-operator-collaboration";

describe("group operator collaboration", () => {
  it("includes the operator's own reception customers when the account also has the reception role", () => {
    expect(resolveAccessibleReceptionistIds({
      operatorId: "dual-frontline",
      pairedReceptionistIds: [],
      isReceptionist: true,
    })).toEqual(["dual-frontline"]);
  });

  it("does not duplicate the operator when the lead also saved an explicit self-pairing", () => {
    expect(resolveAccessibleReceptionistIds({
      operatorId: "dual-frontline",
      pairedReceptionistIds: ["reception-a", "dual-frontline"],
      isReceptionist: true,
    })).toEqual(["reception-a", "dual-frontline"]);
  });
});
