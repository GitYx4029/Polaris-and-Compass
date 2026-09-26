// Short summaries of the cited primary sources; English statements are
// paraphrased into Chinese. These are not verbatim Chinese quotations.
export type InvestorQuote = {
  id: number;
  author: string;
  text: string;
  source: string;
  locator: string;
  url: string;
};

const buffett1989 = "https://www.berkshirehathaway.com/letters/1989.html";
const buffett1992 = "https://www.berkshirehathaway.com/letters/1992.html";
const berks2014 = "https://www.berkshirehathaway.com/letters/2014ltr.pdf";
const duan = "https://xqdoc.imedao.com/176830f1d76db3fe95563ced.pdf";

export const investorQuotes: InvestorQuote[] = [
  { id: 1, author: "沃伦·巴菲特", text: "以合理的价格买优秀企业，胜过用极低的价格买普通企业。", source: "伯克希尔 1989 年致股东信", locator: "Mistakes of the First Twenty-Five Years", url: buffett1989 },
  { id: 2, author: "查理·芒格", text: "少做几类真正理解的事，并长期投入注意力。", source: "伯克希尔 2014 年年报·芒格专文", locator: "p.40（PDF 第 40 页）", url: `${berks2014}#page=40` },
  { id: 3, author: "段永平", text: "买入股票，首先要理解自己买下的是一家公司的生意。", source: "雪球《段永平投资问答录·投资逻辑篇》", locator: "p.8", url: `${duan}#page=8` },
  { id: 4, author: "沃伦·巴菲特", text: "好生意的长期经营会让时间成为朋友；平庸生意则相反。", source: "伯克希尔 1989 年致股东信", locator: "Mistakes of the First Twenty-Five Years", url: buffett1989 },
  { id: 5, author: "查理·芒格", text: "把时间留给安静的阅读与思考，学习不应因年龄而停止。", source: "伯克希尔 2014 年年报·芒格专文", locator: "p.39（PDF 第 39 页）", url: `${berks2014}#page=39` },
  { id: 6, author: "段永平", text: "看不懂一家公司的商业模式时，停下来也是一种决策。", source: "雪球《段永平投资问答录·投资逻辑篇》", locator: "p.123", url: `${duan}#page=123` },
  { id: 7, author: "沃伦·巴菲特", text: "投资者要清楚自己的认知边界，并尽量避免重大错误。", source: "伯克希尔 1992 年致股东信", locator: "Common Stock Investments", url: buffett1992 },
  { id: 8, author: "查理·芒格", text: "保留充足的财务余地，才能在少见的机会出现时从容行动。", source: "伯克希尔 2014 年年报·芒格专文", locator: "p.39（PDF 第 39 页）", url: `${berks2014}#page=39` },
  { id: 9, author: "段永平", text: "看公司，更多关注生意模式和企业文化，而非短期股价。", source: "雪球《段永平投资问答录·投资逻辑篇》", locator: "p.123", url: `${duan}#page=123` },
  { id: 10, author: "沃伦·巴菲特", text: "估值即使略高于市价，也不足以替代买入时应有的安全边际。", source: "伯克希尔 1992 年致股东信", locator: "Common Stock Investments", url: buffett1992 },
  { id: 11, author: "查理·芒格", text: "没有必须买入的压力，耐心才有发挥作用的空间。", source: "伯克希尔 2014 年年报·芒格专文", locator: "p.41（PDF 第 41 页）", url: `${berks2014}#page=41` },
  { id: 12, author: "段永平", text: "发现判断有误时，尽早修正，拖延只会增加代价。", source: "雪球《段永平投资问答录·投资逻辑篇》", locator: "p.16", url: `${duan}#page=16` },
  { id: 13, author: "沃伦·巴菲特", text: "简单、稳定且能理解的企业，更适合估计未来现金流。", source: "伯克希尔 1992 年致股东信", locator: "Common Stock Investments", url: buffett1992 },
  { id: 14, author: "查理·芒格", text: "长期决策，应由有机会承担其后果的人来做。", source: "伯克希尔 2014 年年报·芒格专文", locator: "p.39（PDF 第 39 页）", url: `${berks2014}#page=39` },
  { id: 15, author: "段永平", text: "如果市场十年不交易，还愿意持有这家公司吗？", source: "雪球《段永平投资问答录·投资逻辑篇》", locator: "p.122—123", url: `${duan}#page=123` },
  { id: 16, author: "沃伦·巴菲特", text: "与其反复处理难题，不如寻找容易理解的生意。", source: "伯克希尔 1989 年致股东信", locator: "Mistakes of the First Twenty-Five Years", url: buffett1989 },
  { id: 17, author: "查理·芒格", text: "除了做错，错过真正有把握的机会也可能是重大失误。", source: "伯克希尔 2014 年年报·芒格专文", locator: "p.41（PDF 第 41 页）", url: `${berks2014}#page=41` },
  { id: 18, author: "段永平", text: "把关注点放在企业未来现金流，而不只看价格变化。", source: "雪球《段永平投资问答录·投资逻辑篇》", locator: "p.11", url: `${duan}#page=11` },
];

export function quoteIndexAt(timestampMs: number): number {
  return Math.floor((timestampMs + 8 * 60 * 60 * 1000) / 86_400_000) % investorQuotes.length;
}
