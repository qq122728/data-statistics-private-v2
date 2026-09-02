# Authentication Landing Reliability Report（历史测试报告）

> 本文仅记录当时的测试结果，不代表当前页面或业务范围。当前规则请看 [`docs/business/current-business-rules.md`](docs/business/current-business-rules.md)。

## Change

- The login form now consumes the successful login response before navigating, so the browser has applied the session cookie.
- It then performs a hard replace to the safe return path, using `/entry` when no return path was supplied. This prevents the login page's unauthenticated React Server Component state from being reused after login.
- The immediate `router.refresh()` was removed.
- The landing E2E assertion waits for the `/entry` URL and verifies that the `数据录入` heading is visible.

## TDD evidence

- Added a unit assertion that a missing return path resolves to `/entry`.
- Before the implementation, `tests/unit/navigation.test.ts` failed with `Expected: "/entry"` and `Received: "/"`.
- After the implementation, the navigation unit suite passes.

## Verification

- `CI=1 npm run test:e2e -- tests/e2e/auth-landing.spec.ts`: passed (2/2) from a newly started development server.
- `npm test -- --run`: passed (10 files, 39 tests).
- `npm run build`: passed.
- `CI=1 npm run test:e2e`: 23/24 passed. The only failure was the existing concurrent admin-management test waiting for a newly created group to appear; it is outside the authentication scope.

## Note on repeated process starts

Chaining separate Playwright invocations in one shell caused the second dev server to hit `ECONNREFUSED` on port 3000 after the prior server shut down. A standalone cold-start invocation passed; this is runner lifecycle behavior, not a login assertion failure.
