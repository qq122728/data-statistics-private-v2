# Final reports fixes

## Scope delivered

- Cumulative reports now cap `occurredOn` at the server's local current date. Occurrence-date-filtered reports remain incremental.
- Reports now include a channel comparison chart built from the filtered source-cohort rows. It aggregates every displayed metric and keeps same-id channels in different groups separate.
- The top overview now includes expert-introduction and registration totals.
- Batch detail uses responsive metric cards instead of a 1500px-wide table. All nine totals and five rates remain visible at a 1280px desktop viewport without section-level or whole-page horizontal overflow.
- Input validation rejects nonexistent calendar dates and values above Prisma's signed `Int` maximum (`2,147,483,647`).

No entry, admin, or history source file was changed by this task.

## Strict TDD evidence

Each behavior was exercised by a failing test before implementation:

1. Future cumulative event: report-query test failed because `groupLeave` was `1` and `inGroup` was `5`; expected `0` and `6` as of the local current date.
2. Channel aggregation: metrics test first failed with `calculateChannelComparisons is not a function`; the composite group/channel regression then failed with one result instead of two.
3. Channel visualization: Playwright failed because the accessible `渠道对比` region did not exist.
4. Top cards: Playwright failed because the exact `专家介绍` metric card was absent.
5. Desktop detail layout: at 1280px, Playwright measured detail `scrollWidth = 1548` and `clientWidth = 992`.
6. Validation: three focused tests failed because invalid dates, oversized quantity, and oversized recharge cents did not throw.

The targeted tests were rerun after each minimal implementation and passed before moving to the next behavior.

## Final green verification

### Unit suite

Command: `npm test -- --run`

Result: 10 test files passed; 38 tests passed; 0 failed.

### Report browser test

Command: `npx playwright test tests/e2e/reports.spec.ts --reporter=line`

Result: 1 passed; includes real cohort/channel values, top metrics, incremental mode, all batch metrics, and both 1280px horizontal-overflow checks.

### Production build

Command: `npm run build` from an isolated temporary copy that symlinked the same `node_modules`.

Result: compiled successfully, type checking passed, 18 static pages generated, build traces collected, exit code 0.

The first in-place build attempts reached successful compilation/type checking but collided with another agent's concurrently started `next dev`, which rewrote the shared `.next` directory. Process inspection confirmed that environmental race; the isolated build removed only that shared-output interference and required no source change.
