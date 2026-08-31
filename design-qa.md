# Design QA

## Comparison target

- Source visual truth (pre-fix total-company narrow state): `/Users/aaaa/Desktop/数据统计/artifacts/ui-readonly-audit/05-headquarters.png`
- Rendered implementation (post-fix total-company narrow state): `/Users/aaaa/Desktop/数据统计/artifacts/ui-fix-qa/fixed-headquarters.png`
- Combined comparison input, source on the left and implementation on the right: `/Users/aaaa/Desktop/数据统计/artifacts/ui-fix-qa/headquarters-before-after.jpg`
- Additional source visual truth (pre-fix resource narrow state): `/Users/aaaa/Desktop/数据统计/artifacts/ui-readonly-audit/06-resource-ads.png`
- Additional implementation evidence: `/Users/aaaa/Desktop/数据统计/artifacts/ui-fix-qa/fixed-resource-ads.png`
- Additional combined comparison: `/Users/aaaa/Desktop/数据统计/artifacts/ui-fix-qa/resource-before-after.jpg`
- Browser CSS viewport: 478 × 625, device density 1.
- Source pixels: 478 × 625. Browser screenshot output: 468 × 612. Combined comparisons normalize both halves to 478 × 625 solely to align the same viewport/state.
- State: authenticated total-company manager and ADS resource manager on their default workbench views.

## Full-view comparison evidence

Both before/after pairs were opened together as one comparison image. The corrected management shell preserves the existing white-and-blue visual language, card density, typography and control sizing. The total-company sidebar now exposes every navigation label and icon instead of leaving empty icon-only rows. The resource workspace keeps the same layout while replacing “净入金” with the product-wide “净业绩” wording.

## Focused-region comparison evidence

No extra crop was needed because the 478-pixel-wide comparison makes the complete persistent navigation, top header, first toolbar, KPI cards and resource terminology readable in one view. These were the exact regions affected by the repair.

## Required fidelity surfaces

- Fonts and typography: existing system Chinese sans-serif stack, weights and compact hierarchy are unchanged. Narrow navigation labels remain readable without clipping.
- Spacing and layout rhythm: the narrow sidebar is widened only enough to hold icon-plus-text navigation; header title, avatar and “退出” remain on one row.
- Colors and visual tokens: existing blue active state, white cards, cool-gray canvas and border tokens are preserved.
- Image quality and assets: this data application has no raster content. Navigation uses the existing Phosphor icon set; no placeholder glyphs or handmade icons were introduced.
- Copy and content: resource wording is consistently “净业绩”. The removed “待确认每日数据” and “待渠道对账” panels no longer imply an approval workflow that the product does not use.

## Findings and comparison history

- Earlier P1: total-company nested navigation was blank at narrow width because its labels were hidden and the nested buttons had no icons.
  - Fix: added icons to all six nested total-company entries and retained compact navigation text at narrow breakpoints.
  - Post-fix evidence: `headquarters-before-after.jpg` shows every entry visible and distinguishable.
- Earlier P2: all management sidebars became icon-only at narrow width, unlike the member/lead shell.
  - Fix: shared management navigation now stacks the existing icon above a short visible label at 900px and below.
  - Post-fix evidence: total-company, department, company, ADS resource and SMS resource accounts were each logged in at the narrow viewport; persistent navigation and “退出” were visible.
- Earlier P2: the resource workbench used both “净入金” and “净业绩” and exposed approval/reconciliation panels the user had removed from the workflow.
  - Fix: standardized the resource UI on “净业绩” and removed the approval/reconciliation fetches, cards, tables and action handlers from the resource frontend.
  - Post-fix evidence: `resource-before-after.jpg` shows the corrected KPI label. Browser text checks confirmed neither approval label remains on the workbench or daily-channel page.
- No remaining actionable P0, P1 or P2 findings in the repaired states.

## Interaction and runtime verification

- Logged in and inspected: `demo_hq`, `demo_department`, `demo_company`, `demo_resource_ads`, and `demo_resource_sms`.
- Tested total-company navigation visibility, top-bar logout visibility, resource workbench content, daily-channel navigation, and ADS/SMS channel isolation.
- Fresh browser reload produced only React DevTools and HMR connection info; no new runtime error.
- Frontline TypeScript, 28 frontend tests and the production build passed.
- Root TypeScript and the complete root suite passed: 1,123 tests passed, 4 skipped.

## Follow-up polish

- P3: on extremely narrow browser panes, large report tables still require horizontal scrolling. This matches the spreadsheet-style product direction and does not block use.

final result: passed
