import { describe, expect, it } from "vitest";
import { isReceptionReplyArchived, receptionReplyArchiveType } from "../../src/lib/reception-reply-queue";

describe("reception reply archive", () => {
  it("archives customers only after five unanswered follow-ups", () => {
    expect(isReceptionReplyArchived({ followUpCount: 4 })).toBe(false);
    expect(isReceptionReplyArchived({ followUpCount: 5 })).toBe(true);
  });

  it("keeps a later reply out of archive so normal group actions can continue", () => {
    expect(isReceptionReplyArchived({ followUpCount: 8, repliedOn: "2026-08-23" })).toBe(false);
  });

  it("separates unanswered archives from replied but not joined archives", () => {
    expect(receptionReplyArchiveType({ followUpCount: 5 })).toBe("UNANSWERED");
    expect(receptionReplyArchiveType({ repliedOn: "2026-08-23", receptionArchivedAt: "2026-08-26" })).toBe("NOT_JOINED");
    expect(isReceptionReplyArchived({ repliedOn: "2026-08-23", receptionArchivedAt: "2026-08-26" })).toBe(true);
  });
});
