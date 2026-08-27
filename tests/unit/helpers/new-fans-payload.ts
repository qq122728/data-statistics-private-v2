export function newFansPayload(overrides: Record<string, unknown> = {}) {
  return {
    sourceDate: "2026-08-11",
    quantity: 1,
    effectiveFans: 1,
    noNumber: 0,
    duplicateFans: 0,
    ...overrides,
  };
}
