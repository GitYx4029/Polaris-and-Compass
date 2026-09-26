export type Day = { date: string; sh: number; sz: number; total: number; roll20?: number };
export type MarketRow = { date: string; sh: number | null; sz: number | null; failed?: boolean };

// Tencent's index daily bar: [date, open, close, high, low, volume,
// ..., amplitude, turnover (RMB 10,000), ...]. Its embedded qt quote
// carries turnover in RMB yuan at field 35, including the current session.
export function parseTencent(payload: unknown, symbol: "sh000001" | "sz399001") {
  const data = (payload as {data?:Record<string,{day?:unknown;qfqday?:unknown}>;qt?:Record<string,unknown>})?.data?.[symbol];
  const bars = data?.day ?? data?.qfqday;
  if (!Array.isArray(bars)) throw new Error(`${symbol} 缺少日线数据`);
  const amounts = new Map<string,number>();
  for (const bar of bars) {
    if (!Array.isArray(bar) || typeof bar[0] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(bar[0])) continue;
    const units = number(bar[8]);
    if (units !== null && units > 1e6 && units < 1e10) amounts.set(bar[0],units / 1e4);
  }
  const quote = (payload as {data?:Record<string,{qt?:Record<string,unknown>}>})?.data?.[symbol]?.qt?.[symbol];
  let quoteAt: string | null = null;
  if (Array.isArray(quote) && typeof quote[30] === "string" && /^\d{14}$/.test(quote[30])) {
    quoteAt = `${quote[30].slice(0,4)}-${quote[30].slice(4,6)}-${quote[30].slice(6,8)} ${quote[30].slice(8,10)}:${quote[30].slice(10,12)}`;
    const date = quoteAt.slice(0,10);
    const yuan = number(String(quote[35] ?? "").split("/")[2]);
    if (yuan !== null && yuan > 1e10 && yuan < 1e14) {
      const quoteYi = yuan / 1e8;
      const dailyYi = amounts.get(date);
      if (dailyYi !== undefined && quoteAt.slice(11) >= "16:00" && Math.abs(quoteYi/dailyYi-1) > 0.005)
        throw new Error(`${symbol} 日线与收盘行情不一致`);
      if (dailyYi === undefined || date >= [...amounts.keys()].at(-1)!) amounts.set(date,quoteYi);
    }
  }
  if (amounts.size < 20) throw new Error(`${symbol} 历史数据不足20个交易日`);
  return { amounts, quoteAt };
}

const number = (value: unknown): number | null => {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const cleaned = String(value).replace(/,/g, "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

// SSE's daily result is one record per requested product, in PRODUCT_CODE order.
// AKShare's stock_sse_deal_daily maps the fifth property to 成交金额 (亿元).
export function parseSse(payload: unknown, requestedDate?: string): number | null {
  const rows = (payload as { result?: unknown })?.result;
  if (!Array.isArray(rows) || rows.length < 3) return null;
  const main = rows[0], star = rows[2];
  if (!main || !star || typeof main !== "object" || typeof star !== "object") return null;
  if (requestedDate) {
    const reported = String(Object.values(main)[8] ?? "").replace(/[^0-9]/g, "").slice(0,8);
    if (reported !== requestedDate.replace(/-/g, "")) return null;
  }
  const a = number(Object.values(main)[4]);
  const b = number(Object.values(star)[4]);
  if (a === null || b === null || a < 0 || b < 0 || a + b < 100) return null;
  if (rows.length >= 5 && rows[4] && typeof rows[4] === "object") {
    const all = number(Object.values(rows[4])[4]);
    const bShares = rows[1] && typeof rows[1] === "object" ? number(Object.values(rows[1])[4]) : null;
    if (all !== null && bShares !== null && Math.abs(all - (a + b + bShares)) > Math.max(1, all * 0.001)) return null;
  }
  return a + b;
}

// SZSE market overview separates 主板A股 and 创业板A股. Monetary values
// are reported in RMB yuan; retain only those two named categories.
export function parseSzse(payload: unknown): number | null {
  const groups = Array.isArray(payload) ? payload : [payload];
  const rows = groups.flatMap(group => {
    if (Array.isArray(group)) return group;
    if (group && typeof group === "object" && Array.isArray((group as { data?: unknown }).data))
      return (group as { data: unknown[] }).data;
    return [];
  });
  const amounts: number[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const cells = Object.values(row);
    const name = cells.find(cell => typeof cell === "string" && /^(主板A股|创业板A股)$/.test(cell.trim()));
    if (!name) continue;
    const values = cells.map(number).filter((x): x is number => x !== null);
    const amount = values.find(v => v > 1e10);
    if (amount === undefined) return null;
    amounts.push(amount);
  }
  return amounts.length === 2 ? (amounts[0] + amounts[1]) / 1e8 : null;
}

export function composeDays(entries: Array<{ date: string; sh: number | null; sz: number | null; failed?: boolean }>): Day[] {
  const sessions = entries.filter(e => e.failed || (e.sh !== null && e.sh > 0) || (e.sz !== null && e.sz > 0))
    .sort((a,b)=>a.date.localeCompare(b.date));
  return sessions.flatMap((e, i): Day[] => {
    if (e.sh === null || e.sz === null || e.sh <= 0 || e.sz <= 0) return [];
    const total = e.sh + e.sz;
    const window = sessions.slice(i - 19, i + 1);
    const roll20 = window.length === 20 && window.every(x => x.sh !== null && x.sz !== null)
      ? window.reduce((sum, item) => sum + item.sh! + item.sz!, 0) : undefined;
    return [{ date: e.date, sh:e.sh, sz:e.sz, total, ...(roll20 === undefined ? {} : { roll20 }) }];
  });
}
