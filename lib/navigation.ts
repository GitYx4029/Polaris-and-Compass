// Page groups and the floating directory share labels and order.
export const navigationGroups = [
  { number: "01", title: "全市场观察", links: [
    { id: "overview", label: "当日成交额与资金温度" },
    { id: "rolling", label: "20 日累计与均量" },
  ] },
  { number: "02", title: "市场细分", links: [
    { id: "market-depth", label: "市场成交额分布" },
    { id: "market-trends", label: "成交额趋势对比" },
  ] },
  { number: "03", title: "ETF 资金流", links: [
    { id: "etf-inflows", label: "资金净流入前 20 ETF" },
  ] },
  { number: "04", title: "历史与解读", links: [
    { id: "history", label: "近期交易日与下载" },
    { id: "reference", label: "指标解读参考" },
  ] },
] as const;
