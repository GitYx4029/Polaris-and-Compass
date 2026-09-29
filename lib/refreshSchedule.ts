const DAY_MS = 24 * 60 * 60 * 1000;
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const CHECKPOINTS = [12 * 60, 15 * 60 + 15, 15 * 60 + 55,
  16 * 60 + 55, 17 * 60 + 55, 18 * 60 + 55];

export function isCloseConfirmed(date:string,quoteAt:(string|null)[],nowMs:number):boolean {
  const beijing=new Date(nowMs+BEIJING_OFFSET_MS).toISOString();
  const earliest=quoteAt.filter((stamp):stamp is string=>!!stamp).sort().at(0);
  return date===beijing.slice(0,10)&&beijing.slice(11,16)>="15:15"&&
    !!earliest?.startsWith(date)&&earliest.slice(11)>="15:00";
}

// Compute from UTC so visitors outside China see the same scheduled moments.
// Holidays have no new quote; the page retains and labels the last trading day.
export function nextScheduledRefresh(nowMs: number): number {
  const beijing = new Date(nowMs + BEIJING_OFFSET_MS);
  const midnight = Date.UTC(beijing.getUTCFullYear(), beijing.getUTCMonth(), beijing.getUTCDate());
  for (let day = 0; day < 8; day++) {
    const localMidnight = midnight + day * DAY_MS;
    const weekday = new Date(localMidnight).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    for (const minute of CHECKPOINTS) {
      const target = localMidnight + minute * 60_000 - BEIJING_OFFSET_MS;
      if (target > nowMs) return target - nowMs;
    }
  }
  throw new Error("无法计算下一次行情刷新时间");
}
