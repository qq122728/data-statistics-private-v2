import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import type { AnalysisFilters as AnalysisFilterValues } from "../../lib/analytics/types";
import { Button } from "../ui/Button";

type Option = { id: string; name: string; active?: boolean };
type CountryOption = { code: string; name: string };
type ChannelOption = { normalizedName: string; name: string; active?: boolean };
type FilterKey = "period" | "department" | "country" | "group" | "member" | "channel" | "month" | "dates";
type VisibleFilters = Partial<Record<FilterKey, boolean>> & {
  includeInactive?: boolean;
  showInsufficient?: boolean;
};

export function AnalysisFilters({
  action,
  visible,
  primary,
  options,
  values,
  preserve = {},
  fixedGroupName,
  compact = false,
  memberEmptyLabel = "全部人员",
}: {
  action: string;
  visible: VisibleFilters;
  primary: FilterKey[];
  options: {
    groups?: Option[];
    departments?: Option[];
    countries?: CountryOption[];
    members?: Option[];
    channels?: ChannelOption[];
  };
  values: Partial<AnalysisFilterValues>;
  preserve?: Record<string, string | undefined>;
  fixedGroupName?: string;
  compact?: boolean;
  /** 成员明细必须精确到一个人；其他分析页仍可使用“全部人员”。 */
  memberEmptyLabel?: string;
}) {
  const available = (
    ["period", "department", "country", "group", "member", "channel", "month", "dates"] as FilterKey[]
  ).filter((key) => visible[key]);
  const dense = compact || visible.group === false;
  const primaryKeys = primary.filter((key) => visible[key]).slice(0, 3);
  const moreKeys = available.filter((key) => !primaryKeys.includes(key));
  const renderFilter = (key: FilterKey) => {
    if (key === "period")
      return (
        <label key={key} className="field-label">
          统计周期
          <select
            aria-label="统计周期"
            name="period"
            defaultValue={values.period ?? "mature30"}
            className="control min-w-44"
          >
            <option value="mature7">最近 7 个成熟来源日</option>
            <option value="mature30">最近 30 个成熟来源日</option>
            <option value="custom">自定义来源日</option>
          </select>
        </label>
      );
    if (key === "group")
      return (
        <label key={key} className="field-label">
          小组
          <select
            aria-label="小组"
            name="groupId"
            defaultValue={values.groupId ?? ""}
            className="control min-w-36"
          >
            <option value="">全部小组</option>
            {options.groups?.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
                {group.active === false ? "（已停用）" : ""}
              </option>
            ))}
          </select>
        </label>
      );
    if (key === "department")
      return (
        <label key={key} className="field-label">
          下属公司
          <select aria-label="下属公司" name="departmentId" defaultValue={values.departmentId ?? ""} className="control min-w-36">
            <option value="">全部下属公司</option>
            {options.departments?.map((department) => <option key={department.id} value={department.id}>{department.name}{department.active === false ? "（已停用）" : ""}</option>)}
          </select>
        </label>
      );
    if (key === "country")
      return (
        <label key={key} className="field-label">
          国家
          <select aria-label="国家" name="countryCode" defaultValue={values.countryCode ?? ""} className="control min-w-32">
            <option value="">全部国家</option>
            {options.countries?.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
          </select>
        </label>
      );
    if (key === "month")
      return (
        <label key={key} className="field-label">
          整月
          <input aria-label="统计月份" name="month" type="month" defaultValue={values.month} className="control" />
        </label>
      );
    if (key === "member")
      return (
        <label key={key} className="field-label">
          人员
          <select
            aria-label="人员"
            name="memberId"
            defaultValue={values.memberId ?? ""}
            className="control min-w-36"
          >
            <option value="">{memberEmptyLabel}</option>
            {options.members?.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
                {member.active === false ? "（已停用）" : ""}
              </option>
            ))}
          </select>
        </label>
      );
    if (key === "channel")
      return (
        <label key={key} className="field-label">
          渠道
          <select
            aria-label="渠道"
            name="normalizedName"
            defaultValue={values.normalizedName ?? ""}
            className="control min-w-36"
          >
            <option value="">全部渠道</option>
            {options.channels?.map((channel) => (
              <option
                key={channel.normalizedName}
                value={channel.normalizedName}
              >
                {channel.name}
                {channel.active === false ? "（已停用）" : ""}
              </option>
            ))}
          </select>
        </label>
      );
    return (
      <div key={key} className="flex flex-wrap gap-2">
        <label className="field-label">
          来源开始
          <input
            aria-label="来源日期开始"
            name="sourceDateFrom"
            type="date"
            defaultValue={values.sourceDateFrom}
            className="control"
          />
        </label>
        <label className="field-label">
          来源结束
          <input
            aria-label="来源日期结束"
            name="sourceDateTo"
            type="date"
            defaultValue={values.sourceDateTo}
            className="control"
          />
        </label>
      </div>
    );
  };

  const visibleKeys = dense ? [...primaryKeys, ...moreKeys] : primaryKeys;
  const extraControls = (
    <>
      {visible.includeInactive ? (
        <label className="flex min-h-9 items-center gap-2 text-sm font-medium text-slate-600">
          <input
            name="includeInactive"
            value="1"
            type="checkbox"
            defaultChecked={values.includeInactive}
          />
          包含停用人员
        </label>
      ) : null}
      {visible.showInsufficient ? (
        <label className="flex min-h-9 items-center gap-2 text-sm font-medium text-slate-600">
          <input
            name="showInsufficient"
            value="1"
            type="checkbox"
            defaultChecked={values.showInsufficient}
          />
          显示样本不足
        </label>
      ) : null}
    </>
  );

  return (
    <form
      action={action}
      className={`toolbar${dense ? " member-overview-filters" : ""}`}
    >
      {Object.entries(preserve).flatMap(([name, value]) =>
        value
          ? [<input key={name} type="hidden" name={name} value={value} />]
          : [],
      )}
      {fixedGroupName ? (
        <p
          className={
            dense
              ? "member-overview-fixed-group"
              : "m-0 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900"
          }
        >
          <span>固定小组</span>
          <strong>{fixedGroupName}</strong>
        </p>
      ) : null}
      {visibleKeys.map(renderFilter)}
      {dense ? extraControls : null}
      <div className="ml-auto">
        <Button>
          <MagnifyingGlass size={16} aria-hidden="true" />
          查询
        </Button>
      </div>
      {!dense &&
        (moreKeys.length > 0 ||
        visible.includeInactive ||
        visible.showInsufficient ? (
          <details className="w-full border-t border-slate-200 pt-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-600">
              更多筛选
            </summary>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              {moreKeys.map(renderFilter)}
              {extraControls}
            </div>
          </details>
        ) : null)}
    </form>
  );
}
