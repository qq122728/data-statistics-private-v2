import { db } from "../db";
import { buyerPhoneMetrics, parseSheetData } from "../resource-buyer-phones";
import { buyerReport, type BuyerReportRow } from "../resource-buyer-report";
import { queryBounds, type ResourceQuery } from "./query";
export type BotDetail = {
  phone: string;
  channelId: string;
  channel: string;
  buyerId: string;
  buyer: string;
  country: string;
  materialId: string | null;
  material: string;
  sourceDate: string;
  group: string;
  status: string;
  intakeOn: string;
  joinedOn: string;
  expertOn: string;
  registeredOn: string;
  openedOn: string;
  metrics: ReturnType<typeof buyerPhoneMetrics> | null;
};
export async function loadResourceBotData(q: ResourceQuery, today: string) {
  const range = queryBounds(q, today);
  const inRange = (s: string) => !range || (s >= range.from && s <= range.to);
  const channels = await db.channel.findMany({
    where: {
      active: true,
      channelType: q.type === "ALL" ? { in: ["ADS", "SMS"] } : q.type,
      group: { active: true },
    },
    select: {
      id: true,
      name: true,
      channelType: true,
      groupId: true,
      group: { select: { name: true } },
    },
  });
  const requested = q.channel.toLocaleUpperCase();
  const selected = channels.filter(
    (c) =>
      !requested ||
      c.name.toLocaleUpperCase() === requested ||
      c.id === q.channel ||
      c.id.endsWith(q.channel),
  );
  if (q.channel && !selected.length)
    throw Error("找不到这个渠道，请使用网页里的完整渠道名称");
  if (q.channel && new Set(selected.map((c) => c.id)).size > 1)
    throw Error("同名渠道有多个，请在渠道名称后改用网页显示的编号末五位查询");
  const ids = [...new Set(selected.map((c) => c.id))];
  const groups = [...new Set(selected.map((c) => c.groupId))];
  const [attributions, expenses, rows] = await Promise.all([
    db.resourceBuyerPhone.findMany({
      where: { channelId: { in: ids }, ...(q.phone ? { phone: q.phone } : {}) },
      include: {
        buyer: { select: { id: true, name: true } },
        material: { select: { name: true } },
      },
      take: 50001,
    }),
    db.resourceBuyerSpend.findMany({
      where: {
        channelId: { in: ids },
        ...(range ? { spendDate: { gte: range.from, lte: range.to } } : {}),
      },
      include: {
        buyer: { select: { name: true } },
        material: { select: { name: true } },
      },
      take: 50001,
    }),
    db.customerSheetRow.findMany({
      where: {
        groupId: { in: groups },
        ...(q.phone ? { phone: q.phone } : {}),
      },
      select: { id: true, phone: true, groupId: true, data: true },
      take: 50001,
    }),
  ]);
  if (
    attributions.length > 50000 ||
    rows.length > 50000 ||
    expenses.length > 50000
  )
    throw Error("当前查询范围太大，请指定渠道后再查询");
  const copies = new Map(selected.map((c) => [c.id + "|" + c.groupId, c]));
  const names = new Map(selected.map((c) => [c.id, c.name]));
  const live = rows.flatMap((row) => {
    const data = parseSheetData(row.data);
    return data && copies.has(String(data.channelId) + "|" + row.groupId)
      ? [{ ...row, data }]
      : [];
  });
  const byPhone = new Map<string, typeof live>();
  for (const row of live) {
    const k = row.data.channelId + "|" + row.phone;
    byPhone.set(k, [...(byPhone.get(k) || []), row]);
  }
  const attributionMap = new Map<string, typeof attributions>();
  for (const a of attributions) {
    const k = a.channelId + "|" + a.phone;
    attributionMap.set(k, [...(attributionMap.get(k) || []), a]);
  }
  const detail = (
    row: (typeof live)[number] | undefined,
    a: (typeof attributions)[number] | undefined,
    status: string,
  ): BotDetail => {
    const data = row?.data;
    const channelId = a?.channelId || String(data?.channelId || "");
    const c = row ? copies.get(channelId + "|" + row.groupId) : undefined;
    return {
      phone: a?.phone || row?.phone || "",
      channelId,
      channel: names.get(channelId) || "",
      buyerId: a?.buyerId || "",
      buyer: a?.buyer.name || "未登记投手",
      country: a?.country || "",
      materialId: a?.materialId || null,
      material: a?.material?.name || "未指定素材",
      sourceDate: a?.sourceDate || "",
      group: c?.group.name || "",
      status,
      intakeOn: String(data?.intakeOn || ""),
      joinedOn: String(data?.joinedOn || ""),
      expertOn: String(data?.expertOn || ""),
      registeredOn: String(data?.registeredOn || ""),
      openedOn: String(data?.firstDepositOn || data?.orderedOn || ""),
      metrics: data ? buyerPhoneMetrics(data) : null,
    };
  };
  const filter = (d: { buyer: string; country: string; material: string }) =>
    (!q.buyer || d.buyer === q.buyer) &&
    (!q.country || d.country === q.country) &&
    (!q.material || d.material === q.material);
  let details: BotDetail[];
  if (q.view === "phone" || q.view === "orders") {
    details = live.flatMap((row) => {
      const matched = (
        attributionMap.get(row.data.channelId + "|" + row.phone) || []
      ).filter((a) => !a.groupId || a.groupId === row.groupId);
      const candidates =
        byPhone.get(row.data.channelId + "|" + row.phone) || [];
      const a =
        matched.length === 1 && (matched[0].groupId || candidates.length === 1)
          ? matched[0]
          : undefined;
      const d = detail(
        row,
        a,
        a ? "matched" : matched.length ? "ambiguous" : "unattributed",
      );
      return filter(d) &&
        (q.view === "phone" || (d.metrics?.opened && inRange(d.openedOn)))
        ? [d]
        : [];
    });
    if (q.view === "phone" && !details.length)
      details = attributions
        .filter((a) => a.phone === q.phone)
        .map((a) => detail(undefined, a, "pending"))
        .filter(filter);
  } else {
    details = attributions
      .filter((a) => inRange(a.sourceDate))
      .map((a) => {
        const candidates = (
          byPhone.get(a.channelId + "|" + a.phone) || []
        ).filter((r) => !a.groupId || r.groupId === a.groupId);
        return detail(
          candidates.length === 1 ? candidates[0] : undefined,
          a,
          candidates.length === 0
            ? "pending"
            : candidates.length === 1
              ? "matched"
              : "ambiguous",
        );
      })
      .filter(filter);
  }
  const spends = expenses
    .map((s) => ({
      ...s,
      buyer: s.buyer.name,
      material: s.material?.name || "未指定素材",
      channel: names.get(s.channelId) || "",
    }))
    .filter(filter);
  const summary = buyerReport(details, spends, q.dimension === "material");
  // Shared reducer and metrics match the resource web report; country/channel grouping adds only these dimensions.
  let aggregate = summary;
  if (q.dimension === "channel" || q.dimension === "country") {
    const grouped = new Map<string, BuyerReportRow>();
    for (const item of summary) {
      const key = q.dimension === "channel" ? item.channelId : item.country;
      let r = grouped.get(key);
      if (!r) {
        r = {
          ...item,
          buyer: "全部投手",
          material: "全部素材",
          spend: [],
          imported: 0,
          matched: 0,
          pending: 0,
          ambiguous: 0,
          valid: 0,
          replied: 0,
          joined: 0,
          expert: 0,
          registered: 0,
          opened: 0,
          firstCents: 0,
          rechargeCents: 0,
          withdrawalCents: 0,
          legacyCents: 0,
          netCents: 0,
          ...(q.dimension === "channel"
            ? { country: "" }
            : { channel: "全部渠道" }),
        };
        grouped.set(key, r);
      }
      for (const f of [
        "imported",
        "matched",
        "pending",
        "ambiguous",
        "valid",
        "replied",
        "joined",
        "expert",
        "registered",
        "opened",
        "firstCents",
        "rechargeCents",
        "withdrawalCents",
        "legacyCents",
        "netCents",
      ] as const)
        r[f] += item[f];
      for (const s of item.spend) {
        const t = r.spend.find((x) => x.currency === s.currency);
        if (t) t.amountCents += s.amountCents;
        else r.spend.push({ ...s });
      }
    }
    aggregate = [...grouped.values()];
  }
  const currencies = new Set(
    aggregate.flatMap((r) => r.spend.map((s) => s.currency)),
  );
  if (q.sort === "cost" && currencies.size > 1)
    throw Error(
      "当前消耗包含多种币种，不能直接比较成本，请缩小到同币种的渠道或投手",
    );
  const cost = (r: BuyerReportRow) =>
    r.opened && r.spend.length === 1
      ? r.spend[0].amountCents / r.opened
      : Infinity;
  aggregate.sort((a, b) =>
    q.sort === "cost"
      ? cost(a) - cost(b)
      : q.sort === "rate"
        ? (b.matched ? b.opened / b.matched : -1) -
          (a.matched ? a.opened / a.matched : -1)
        : q.sort === "imported"
          ? b.imported - a.imported
          : q.sort === "net"
            ? b.netCents - a.netCents
            : b.opened - a.opened,
  );
  details.sort(
    (a, b) =>
      b.openedOn.localeCompare(a.openedOn) ||
      b.sourceDate.localeCompare(a.sourceDate),
  );
  return {
    range,
    details,
    summary: aggregate,
    spends,
    unattributed: live.filter(
      (r) =>
        !(attributionMap.get(r.data.channelId + "|" + r.phone) || []).some(
          (a) => !a.groupId || a.groupId === r.groupId,
        ),
    ).length,
  };
}
export type ResourceBotData = Awaited<ReturnType<typeof loadResourceBotData>>;
export async function loadResourceBotCatalog() {
  const channels = await db.channel.findMany({
    where: {
      active: true,
      channelType: { in: ["ADS", "SMS"] },
      group: { active: true },
    },
    select: { id: true, name: true, group: { select: { name: true } } },
  });
  const channelIds = [...new Set(channels.map((c) => c.id))];
  const [buyers, materials] = await Promise.all([
    db.trafficBuyer.findMany({
      where: { channelId: { in: channelIds } },
      select: { name: true },
    }),
    db.resourceBuyerMaterial.findMany({
      where: { channelId: { in: channelIds } },
      select: { name: true },
    }),
  ]);
  return {
    channels: [...new Set(channels.map((c) => c.name))],
    buyers: [...new Set(buyers.map((b) => b.name))],
    materials: [...new Set(materials.map((m) => m.name))],
    groups: [...new Set(channels.map((c) => c.group.name))],
  };
}
