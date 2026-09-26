const DAY_MS = 24 * 60 * 60 * 1000;
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const CHECKPOINTS = [12 * 60, 15 * 60 + 15];

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
