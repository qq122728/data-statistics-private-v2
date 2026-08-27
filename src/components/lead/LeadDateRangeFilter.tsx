import Link from "next/link";
import { leadDatePresets, leadDateRangeForPreset, type LeadDateRange } from "../../lib/lead-date-range";

type PreservedValue = string | string[] | boolean | undefined;

function appendPreservedValue(params: URLSearchParams, key: string, value: PreservedValue) {
  if (value === undefined || value === false || value === "") return;
  if (Array.isArray(value)) {
    for (const item of value) if (item) params.append(key, item);
    return;
  }
  params.set(key, value === true ? "1" : value);
}

function hrefFor(pathname: string, range: LeadDateRange, preserve: Record<string, PreservedValue>) {
  const params = new URLSearchParams({ range: range.preset });
  if (range.preset !== "all") {
    params.set("sourceDateFrom", range.from);
    params.set("sourceDateTo", range.to);
  }
  for (const [key, value] of Object.entries(preserve)) {
    if (key === "range" || key === "sourceDateFrom" || key === "sourceDateTo") continue;
    appendPreservedValue(params, key, value);
  }
  return `${pathname}?${params.toString()}`;
}

export function LeadDateRangeFilter({ pathname, range, today, ariaLabel = "时间范围", preserve = {}, allowAll = false }: { pathname: string; range: LeadDateRange; today: string; ariaLabel?: string; preserve?: Record<string, PreservedValue>; allowAll?: boolean }) {
  const presets = allowAll ? [{ value: "all" as const, label: "全部" }, ...leadDatePresets] : leadDatePresets;
  // <details> 的开关状态由浏览器自己保存。页面做局部跳转后，即使时间范围
  // 已切回“当月／近 7 天”，旧节点也可能仍保持展开。用当前筛选生成 key，
  // 每次查询条件变化时重建节点，让非自定义范围一定从关闭状态开始。
  const customPanelKey = JSON.stringify({
    preset: range.preset,
    from: range.from,
    to: range.to,
    preserve,
  });
  return (
    <section className="lead-date-toolbar" aria-label={ariaLabel}>
      <div className="lead-date-presets">
          {presets.map((preset) => {
            const target = leadDateRangeForPreset(preset.value, today);
            const active = range.preset === preset.value;
            return <Link key={preset.value} href={hrefFor(pathname, target, preserve)} data-active={active} aria-current={active ? "page" : undefined}>{preset.label}</Link>;
          })}
      </div>
      <details key={customPanelKey} className="lead-date-custom" open={range.preset === "custom"}>
        <summary>自定义</summary>
        <form action={pathname}>
          <input type="hidden" name="range" value="custom" />
          {Object.entries(preserve).flatMap(([name, value]) => {
            if (name === "range" || name === "sourceDateFrom" || name === "sourceDateTo" || value === undefined || value === false || value === "") return [];
            if (Array.isArray(value)) return value.filter(Boolean).map((item) => <input key={`${name}:${item}`} type="hidden" name={name} value={item} />);
            return [<input key={name} type="hidden" name={name} value={value === true ? "1" : value} />];
          })}
          <label>开始<input aria-label="自定义开始日期" name="sourceDateFrom" type="date" defaultValue={range.preset === "custom" ? range.from : ""} max={today} required /></label>
          <label>结束<input aria-label="自定义结束日期" name="sourceDateTo" type="date" defaultValue={range.preset === "custom" ? range.to : ""} max={today} required /></label>
          <button type="submit">应用</button>
        </form>
      </details>
      <span className="lead-date-current">{range.preset === "all" ? "全部历史客户" : `${range.from} 至 ${range.to}`}</span>
    </section>
  );
}
