import Link from "next/link";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import { leadDatePresets, leadDateRangeForPreset, type LeadDateRange } from "../../lib/lead-date-range";
import type { ChannelFilterOption } from "../../lib/report-filters";
import { Button } from "../ui/Button";

function hrefFor(range: LeadDateRange, values: { memberId?: string; normalizedName?: string; includeInactive?: boolean }) {
  const params = new URLSearchParams({ range: range.preset, sourceDateFrom: range.from, sourceDateTo: range.to });
  if (values.memberId) params.set("memberId", values.memberId);
  if (values.normalizedName) params.set("normalizedName", values.normalizedName);
  if (values.includeInactive) params.set("includeInactive", "1");
  return `/dashboard?${params.toString()}`;
}

export function LeadDashboardToolbar({
  range,
  today,
  members,
  channels,
  values,
}: {
  range: LeadDateRange;
  today: string;
  members: Array<{ id: string; name: string; active: boolean }>;
  channels: ChannelFilterOption[];
  values: { memberId?: string; normalizedName?: string; includeInactive?: boolean };
}) {
  // 和分析页的日期组件保持同一规则：切换快捷日期或提交筛选后，浏览器
  // 不能把上一次手动打开的“自定义”抽屉遗留在当前页面。
  const customPanelKey = JSON.stringify({
    preset: range.preset,
    from: range.from,
    to: range.to,
    values,
  });
  return (
    <section className="lead-dashboard-toolbar" aria-label="组长筛选">
      <div className="lead-dashboard-presets" aria-label="快捷时间范围">
        {leadDatePresets.map((preset) => {
          const target = leadDateRangeForPreset(preset.value, today);
          return <Link key={preset.value} href={hrefFor(target, values)} data-active={range.preset === preset.value}>{preset.label}</Link>;
        })}
      </div>
      <form action="/dashboard" className="lead-dashboard-main-filters">
        <input type="hidden" name="range" value={range.preset} />
        <input type="hidden" name="sourceDateFrom" value={range.from} />
        <input type="hidden" name="sourceDateTo" value={range.to} />
        <label className="field-label">接粉归属<select aria-label="接粉归属" name="memberId" defaultValue={values.memberId ?? ""} className="control"><option value="">全部接粉员</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}{member.active ? "" : "（已停用）"}</option>)}</select></label>
        <label className="field-label">渠道<select aria-label="渠道" name="normalizedName" defaultValue={values.normalizedName ?? ""} className="control"><option value="">全部渠道</option>{channels.map((channel) => <option key={channel.normalizedName} value={channel.normalizedName}>{channel.name}{channel.active ? "" : "（已停用）"}</option>)}</select></label>
        <label className="lead-dashboard-check"><input name="includeInactive" value="1" type="checkbox" defaultChecked={values.includeInactive} />含停用</label>
        <Button><MagnifyingGlass size={16} aria-hidden="true" />查询</Button>
      </form>
      <details key={customPanelKey} className="lead-dashboard-custom" open={range.preset === "custom"}>
        <summary>自定义</summary>
        <form action="/dashboard">
          <input type="hidden" name="range" value="custom" />
          {values.memberId ? <input type="hidden" name="memberId" value={values.memberId} /> : null}
          {values.normalizedName ? <input type="hidden" name="normalizedName" value={values.normalizedName} /> : null}
          {values.includeInactive ? <input type="hidden" name="includeInactive" value="1" /> : null}
          <label className="field-label">开始<input className="control" aria-label="自定义开始日期" name="sourceDateFrom" type="date" defaultValue={range.preset === "custom" ? range.from : ""} max={today} required /></label>
          <label className="field-label">结束<input className="control" aria-label="自定义结束日期" name="sourceDateTo" type="date" defaultValue={range.preset === "custom" ? range.to : ""} max={today} required /></label>
          <button type="submit">应用</button>
        </form>
      </details>
      <span className="lead-dashboard-range">{range.from} 至 {range.to}</span>
    </section>
  );
}
