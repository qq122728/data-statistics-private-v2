import Link from "next/link";
import { Buildings, Gear, ListChecks, ShareNetwork, UserList, UsersThree, WarningDiamond } from "@phosphor-icons/react/dist/ssr";

export type AdminSection = "members" | "departments" | "groups" | "channels" | "risk" | "audit" | "settings";

const items = [
  { id: "members", label: "成员管理", Icon: UserList },
  { id: "departments", label: "下属公司", Icon: Buildings },
  { id: "groups", label: "小组管理", Icon: UsersThree },
  { id: "channels", label: "渠道管理", Icon: ShareNetwork },
  { id: "risk", label: "预警规则", Icon: WarningDiamond },
  { id: "audit", label: "操作日志", Icon: ListChecks },
  { id: "settings", label: "系统设置", Icon: Gear },
];

export function AdminSectionNav({ active }: { active: AdminSection }) {
  return <aside className="border-b border-slate-200 bg-white px-4 py-5 lg:min-h-[calc(100vh-4rem)] lg:w-52 lg:flex-none lg:border-b-0 lg:border-r lg:px-5 lg:py-8">
    <h1 className="px-3 text-xl font-bold tracking-tight text-slate-950">管理员中心</h1>
    <nav aria-label="管理员中心" className="mt-5 flex gap-2 overflow-x-auto lg:flex-col">
      {items.map((item) => <Link key={item.id} href={`/admin?section=${item.id}`} className={`flex min-w-max items-center gap-3 rounded-md px-3 py-3 text-sm font-medium transition ${active === item.id ? "bg-slate-950 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"}`}>
        <item.Icon aria-hidden size={20} weight={active === item.id ? "fill" : "regular"} />{item.label}
      </Link>)}
    </nav>
  </aside>;
}
