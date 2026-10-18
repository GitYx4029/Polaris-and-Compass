// Page groups and the floating directory share labels and order.
export const navigationGroups = [
  { number: "01", id: "today", title: "今日概览", links: [
    { id: "overview", label: "当日成交额与资金温度" },
    { id: "rolling", label: "20 日累计与均量" },
    { id: "margin", label: "融资与杠杆" },
  ] },
  { number: "02", id: "market", title: "市场结构与趋势", links: [
    { id: "market-depth", label: "市场成交额分布" },
    { id: "market-trends", label: "成交额趋势对比" },
  ] },
  { number: "03", id: "etf", title: "ETF 资金流", links: [
    { id: "etf-inflows", label: "资金净流入前 20 ETF" },
  ] },
  { number: "04", id: "resources", title: "历史与解读", links: [
    { id: "history", label: "近期交易日与下载" },
    { id: "reference", label: "指标解读参考" },
    { id: "margin-reference", label: "融资阶梯参考" },
  ] },
] as const;
