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

## Shared customer sheet restoration

- Reference image: `/var/folders/2k/gjysw4mn4tj5wrs0szcsvl040000gn/T/codex-clipboard-ee7f04b3-d763-421e-9cef-3d2d34bcc439.png`
- Implementation screenshot: `/Users/aaaa/Desktop/数据统计/design-qa-shared-customer-sheet.png`
- Viewport: 1920px desktop.
- Visual hierarchy, sidebar, toolbar, sheet header, column density, borders, colors, and whitespace match the approved reference.
- Search, progress filter, horizontal scrolling, pagination, and the add-customer modal render correctly.
- The live table uses real group customer data and exposes editable group/expert progress cells with automatic-save wiring.
- Device accounts load under the same shell, are scoped to the current member, and include NORMAL WS, BUSINESS WS, RCS, and SIG choices.
- Browser console contains no warnings or errors.

final result: passed

## Compact customer progress filters

- Source visual truth: `/var/folders/2k/gjysw4mn4tj5wrs0szcsvl040000gn/T/codex-clipboard-31df0dee-15df-4450-8de0-c59076a43ded.png`
- Browser-rendered implementation: `/tmp/customer-progress-compact.png`
- Combined comparison input: `/tmp/customer-progress-comparison.png`
- Source pixels: 1694 × 343. Implementation screenshot: 1270 × 714 from a 1280 × 720 CSS viewport at density 1. The focused implementation content was cropped to the same top-of-page region and proportionally normalized to the source width for the combined comparison.
- State: authenticated group member, customer progress page, “在群待推专家”, all filters reset.

### Full-view and focused comparison evidence

The combined image places the original expanded customer-import instructions above the implemented compact state. The implementation keeps the approved white-and-blue system but collapses the instructions from 124px to 36px, moves customer status into the toolbar, and adds member and channel selectors. The table header begins immediately below the single-row toolbar and sheet header, materially increasing the visible customer-table area. This top region is the full scope of the requested change, so a separate smaller crop was unnecessary.

### Required fidelity surfaces

- Fonts and typography: existing Chinese system font, title hierarchy and small spreadsheet labels are preserved; filter labels remain readable at the compact size.
- Spacing and layout rhythm: instructions, toolbar and sheet header now use 36px, 44px and 52px visible heights respectively; controls align on one row at desktop width and wrap at narrow breakpoints.
- Colors and visual tokens: existing white surfaces, cool-gray borders, blue active state and green live-status token are unchanged.
- Image quality and assets: this screen contains no raster imagery; the existing Phosphor search and add icons remain intact.
- Copy and content: customer filters are explicitly named “客户状态”, “归属组员” and “来源渠道”; the full three-step instructions remain available through “展开查看操作说明”.

### Findings and comparison history

- Earlier P1: the permanently expanded three-step guide and separate status-chip row consumed a large part of the usable table viewport.
  - Fix: the guide now defaults to a one-line disclosure and the status filter moved into the compact toolbar.
  - Post-fix evidence: the combined comparison shows the customer table header and first data row entering the initial viewport much earlier.
- Earlier P2: users could not directly isolate customers by attribution member or source channel.
  - Fix: added native member and channel dropdowns alongside the status selector, each resetting pagination and filtering the visible customer list.
  - Post-fix evidence: browser checks returned the correct empty state for “演示专家”, 3 rows for “演示短信渠道”, and 2 rows for “已退群”.
- No remaining actionable P0, P1 or P2 findings.

### Interaction and runtime verification

- Verified guide expand/collapse: 36px collapsed and 118.75px expanded.
- Verified status, attribution member and source channel selectors, plus the empty-filter state.
- Browser console contained no errors.
- Frontline suite: 46 tests passed. Production build and TypeScript checks passed.

final result: passed

## Headquarters administrator group matrix

- Source visual truth: `/var/folders/2k/gjysw4mn4tj5wrs0szcsvl040000gn/T/codex-clipboard-51f1875c-b725-4baa-821c-db2b6427f8a2.png`
- Browser-rendered implementation: `/Users/aaaa/Desktop/数据统计/outputs/数据矩阵验证/总公司管理员-小组矩阵.png`
- Combined comparison: `/Users/aaaa/Desktop/数据统计/outputs/数据矩阵验证/总公司参考与实现并排对比.jpg`
- Source pixels: 871 × 752; implementation pixels: 1270 × 1372; browser viewport: 1280 × 720 at density 1. Both images were proportionally fitted into 1000 × 900 boxes for comparison.
- State: authenticated `demo_hq`, 数据汇总 → 按小组 → 系统演示组 → 查看矩阵.

### Full-view and focused comparison evidence

The side-by-side image confirms the headquarters view now has the requested spreadsheet orientation: metrics run vertically, while total and members run horizontally. The group-scoped API also inserts channel columns whenever the selected group has channel data. The entire matrix is readable in the full comparison, so no additional focused crop was required.

### Required fidelity surfaces

- Fonts and typography: matches the existing management workbench system font, compact table hierarchy, bold total column and two-line column headings.
- Spacing and layout rhythm: preserves the headquarters filters and summary table, then expands the matrix directly below the selected group without disrupting navigation.
- Colors and visual tokens: reuses the approved blue total column, green calculated rows, red exception rows and neutral grid borders.
- Image quality and assets: the interface is data-only and introduces no raster assets or substitute icons.
- Copy and content: the group row exposes a clear “查看矩阵” action; the expanded card explains “左侧是指标，横向同时对比合计、渠道和组员”.

### Findings and comparison history

- Earlier P1: the headquarters administrator could only see the old horizontal group summary and had no path into the group matrix.
  - Fix: the 按小组 table now makes each group row actionable and expands the shared `OrgGroupMetricMatrix` below it.
  - Post-fix evidence: `总公司管理员-小组矩阵.png` shows the explicit action, expanded matrix and working 收起明细 control.
- No remaining actionable P0, P1 or P2 findings.

### Interaction and runtime verification

- Verified company/department/group filters, 按小组 tab, 查看矩阵, group-scoped API response, matrix headings and 收起明细.
- The demo matrix rendered indicator, total and three member columns.
- Frontline tests: 44 passed. Production build and TypeScript checks passed.

final result: passed

## Group / department / company data matrix

- Source visual truth: `/var/folders/2k/gjysw4mn4tj5wrs0szcsvl040000gn/T/codex-clipboard-51f1875c-b725-4baa-821c-db2b6427f8a2.png`
- Company implementation screenshot: `/Users/aaaa/Desktop/数据统计/outputs/数据矩阵验证/公司管理员-小组矩阵.png`
- Lead implementation screenshot: `/Users/aaaa/Desktop/数据统计/outputs/数据矩阵验证/组长-数据矩阵.png`
- Normalized side-by-side comparison: `/Users/aaaa/Desktop/数据统计/outputs/数据矩阵验证/参考与实现并排对比.jpg`
- Source pixels: 871 × 752; implementation pixels: 1270 × 1349; browser CSS viewport: 1280 × 720 at density 1. The comparison scales each image into a 1000 × 900 maximum box without changing aspect ratio.
- State: authenticated company administrator with the group view selected and the group matrix expanded; authenticated group lead on the group summary page.

### Full-view and focused comparison evidence

The combined image shows the source and implementation together. Both use the required spreadsheet orientation: indicators form the left vertical axis, while total and people form horizontal columns. The implementation additionally supports channel columns when the selected group has channel data and preserves the surrounding product navigation and smart date controls. The matrix itself is the focused region; an additional crop was unnecessary because all headings, tinted metric rows and values are readable in the normalized comparison.

### Required fidelity surfaces

- Fonts and typography: the implementation keeps the product's existing Chinese system font, compact table sizing, strong total column, and readable two-line column labels.
- Spacing and layout rhythm: the matrix uses compact spreadsheet rows, a fixed indicator column, fixed total column, and horizontal overflow for larger channel/member sets.
- Colors and visual tokens: the source's blue summary cells, green calculated/status rows, red exception rows, and pale grid borders are represented with the existing product tokens.
- Image quality and assets: this is a data table and has no imagery or decorative bitmap assets to reproduce.
- Copy and content: the implemented indicator list matches current product rules, including 人工无效、有效数据、回复率、进群率、异常退群率、注册率、开单率 and financial fields through 净业绩. Lawyer groups use their separate metric set.

### Comparison history and findings

- Earlier P1: company and department administrators could only see entities as rows and metrics as columns, so they could not inspect one group in the requested spreadsheet orientation.
  - Fix: group rows now open a group-scoped matrix containing total, channels and members.
  - Post-fix evidence: `公司管理员-小组矩阵.png` shows the expanded matrix under the group summary.
- Earlier P1: the group lead page only offered separate member/channel/day reports and lacked the same shared visual summary.
  - Fix: the group lead summary now includes the matrix before smart analysis, using the identical component and metric definitions.
  - Post-fix evidence: `组长-数据矩阵.png` shows the lead matrix and the existing export/report controls on one page.
- No remaining actionable P0, P1 or P2 visual findings. The demo September state has zero values, but the structural display and real API wiring are verified.

### Interaction and runtime verification

- Logged in as `demo_department`, `demo_company`, and `demo_lead`.
- Verified group-row matrix expansion, close control, indicator rows, total/member headings, date-range changes, and the lead report export control.
- Company matrix rendered five horizontal columns in the demo state (indicator, total, and three members).
- Frontline tests and production build passed.

final result: passed
