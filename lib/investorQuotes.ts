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
const marks = "https://www.oaktreecapital.com/insights/memo/the-best-of";
const ownersManual = "https://www.berkshirehathaway.com/1996ar/manual.html";
const fundsmithManual = "https://www.fundsmith.co.uk/media/mv3abv1h/owner-s-manual.pdf";

// Section numbers point to Buffett's own 1996 Owner's Manual.
const buffettManualHighlights: Array<[string,string]> = [
  ["Principle 1","把持有股票看成持有企业的一部分，主要跟踪企业的长期经营。"],
  ["Principle 1","短期报价的意义之一，是让长期投资者在价格合适时增持。"],
  ["Principle 2","经营者和董事自己承担资本决策的结果，有助于与股东利益一致。"],
  ["Principle 3","衡量管理成效时，更关注每股价值而非公司的绝对规模。"],
  ["Principle 4","持续投入资金的投资者面对市场下跌时，也会遇到更便宜的买入价。"],
  ["Principle 4","企业以低价回购自己的股份，留存股东可以从中受益。"],
  ["Principle 5","合并报表的单一盈利数字，不足以完全呈现旗下生意的经济表现。"],
  ["Principle 5","分析业绩时，要辨别企业所处行业的顺风或逆风。"],
  ["Principle 5","管理层解释自己如何思考，有助于股东检验资本配置。"],
  ["Principle 6","投资决定应看经济收益，不应仅为让会计利润更好看。"],
  ["Principle 6","被投资企业留下的利润若能高回报再投资，股东仍可能受益。"],
  ["Principle 7","债务宜审慎使用，不能为一笔诱人的交易过度借款。"],
  ["Principle 7","不要为了额外的几点收益，承担会威胁已有成果的风险。"],
  ["Principle 7","评估融资时，连资金成本和未来偿还条件都要看清。"],
  ["Principle 8","只有符合股东长远利益的收购，才值得配置资本。"],
  ["Principle 8","收购应提高每股内在价值，不能为了扩大公司规模而交易。"],
  ["Principle 9","留存利润应为股东创造不低于留存金额的长期价值。"],
  ["Principle 10","发行新股时，要确认收到的业务价值不低于交出的股权价值。"],
  ["Principle 11","好企业若仍有良好经济表现，不必因短期价格波动而轻易卖掉。"],
  ["Principle 12","向股东坦诚说明坏消息，才有助于其评估业务和管理层。"],
  ["Principle 13","稀缺的好投资想法具有竞争价值，披露决策原则比披露持仓更适宜。"],
  ["An Added Principle","股价长期贴近内在价值，更有利于长期持有人公平进出。"],
  ["Intrinsic Value","企业内在价值取决于未来能够提取的现金流折现。"],
  ["Intrinsic Value","内在价值是一种估计，利率和现金流预期改变时应重新计算。"],
  ["Intrinsic Value","账面价值方便计算，却可能与真实经营价值相差很远。"]
];

// Fundsmith's Owner's Manual is the source; these Chinese lines are summaries.
const smithHighlights: Array<[string,string]> = [
  ["p.1","评价长期投资，回报要和承担的风险一起考虑。"],
  ["p.1","与管理人的理念和持有周期不匹配，会影响实际取得的回报。"],
  ["p.2","投资者在市场高点追买、低点卖出，可能落后于持有的基金本身。"],
  ["p.2","先找到适合长期持有的资产，再练习耐心持有。"],
  ["p.4","管理人与同行过度趋同，可能错过独立判断带来的机会。"],
  ["p.5","增长和收益的标签，不能代替对企业经济结构的分析。"],
  ["p.6","高质量企业能长期保持较高的投入资本回报率。"],
  ["p.6","每股盈利增长须结合投入资本和现金回报来看。"],
  ["p.6","频繁交易带来摩擦成本，长期持有能少付这笔成本。"],
  ["p.6","好机会不必每天出现，应审慎使用有限的决策次数。"],
  ["p.7","稳定的重复购买需求，有助于维持企业长期回报。"],
  ["p.7","购买可以延期的产品，可能受到经济周期更明显的冲击。"],
  ["p.7","服务和零配件收入也可能让工业企业获得重复性业务。"],
  ["p.8","难复制的品牌、专利和分销网络，可能延长企业优势。"],
  ["p.8","不能仅靠期待下一个买家出更高价来论证一项投资。"],
  ["p.8","企业如果靠不断加杠杆才有较高股本回报，需格外审慎。"],
  ["p.8","考察杠杆风险时，也要把表外租赁等负担纳入。"],
  ["p.8","增长的价值取决于新增投入资本能带来多少回报。"],
  ["p.8","售价上升未必能持续提高利润，还可能吸引竞争者。"],
  ["p.9","改变世界的创新，未必同时给该领域的股东带来好回报。"],
  ["p.9","产品不易迅速过时，有助于提高业务韧性。"],
  ["p.9","即使公司很好，买得太贵仍可能拖累投资结果。"],
  ["p.9","估值时观察自由现金流，而不仅看利润表上的数字。"],
  ["p.9","对市场择时没有优势时，不必把频繁调整仓位当作策略。"],
  ["p.10","周期性行业有时要求同时判断经营和市场两个周期。"],
  ["p.10","周期顶点的低市盈率，可能对应不可持续的高利润。"],
  ["p.10","用一年成绩评价多年投资，时间尺度可能过短。"],
  ["p.11","全球比较企业，能扩大估值与增长率的选择范围。"],
  ["p.11","评估集中持仓时，先看行业和商业模式是否真的分散。"],
  ["p.12","上市地点不一定等于企业收入和利润所在地区。"],
  ["p.12","见管理层时，观察其是否如实说明经营，而非仅包装股价。"],
  ["p.15","基金交易费用和管理费会从持有人实际收益中扣除。"]
];

// Each entry paraphrases one named section in Marks's own 2025 memo index.
// The index links to the underlying memo and makes the source easy to check.
const marksHighlights: Array<[string,string]> = [
  ["The Route to Performance","长期成绩更依赖连续的稳健回报和少犯大错，而非少数惊艳年份。"],
  ["First Quarter Performance","投资者的乐观与悲观反复摆动，情绪周期本身值得观察。"],
  ["How the Game Should Be Played","投资不必每次都追求全垒打；先提高持续获胜的概率。"],
  ["bubble.com","热门叙事若代替对价格的检验，泡沫便可能形成。"],
  ["What’s It All About, Alpha?","既不能盲信市场完全有效，也不能无视市场有效性带来的竞争。"],
  ["You Can’t Predict. You Can Prepare.","不必假装知道未来，先认清市场处在周期的什么位置。"],
  ["The Realist’s Creed","承认不知道宏观前景，把精力转向基本面和自己的专长。"],
  ["Returns and How They Get That Way","股价的长期回报不能总靠估值抬升，盈利增长更有根基。"],
  ["What’s Your Game Plan?","少踩明显的坑，让长期表现由持续的正确决定累积。"],
  ["Us and Them","预测驱动的自信与风险意识不同，选择适合自己的决策方式。"],
  ["Hedge Funds: A Case for Caution","任何资产类别都没有天然的高回报，关键仍是定价与识别能力。"],
  ["Risk","为获得收益可以承担风险，但应先看潜在补偿是否足够。"],
  ["Dare to Be Great","追求超额回报前，先想清楚自己愿意承受多大偏离与风险。"],
  ["The New Paradigm","资金大量涌入某一类资产时，也要检视管理人的激励是否变化。"],
  ["Pigweed","短期成功可能来自运气，不能仅凭一段高收益断定能力。"],
  ["The Race to the Bottom","资金过剩又急于投出时，投资条件往往容易松动。"],
  ["It’s All Good","过多杠杆、未经检验的结构和轻易融资会放大繁荣的隐患。"],
  ["It’s All Good… Really?","无法预言情绪反转的导火索，却不能假设单边行情永久延续。"],
  ["Now It’s All Bad?","高杠杆与低流动性叠加时，市场心理可能迅速逆转。"],
  ["The Limits to Negativism","过度悲观的定价有时会给保持判断力的人带来机会。"],
  ["Volatility + Leverage = Dynamite","杠杆能承受多少，取决于资产波动和持有人的持续承压能力。"],
  ["All That Glitters","没有现金流的资产较难用传统现金流方法估计内在价值。"],
  ["Déjà Vu All Over Again","情绪走向极端时，投资者尤其需要回顾历史教训。"],
  ["It’s All a Big Mistake","买入价足够低，才可能从别人的定价失误中获益。"],
  ["The Outlook for Equities","过去涨得越好，未来可期待的回报未必越高。"],
  ["Getting Lucky","评估成败要给运气留位置，别把所有结果都归于能力。"],
  ["Dare to Be Great II","与众不同只是争取超额回报的条件之一，还需承受暂时看错的压力。"],
  ["Risk Revisited Again","风险包含多种可能的结局，很难压缩成单一数字。"],
  ["It’s Not Easy","看见别人忽略的事、控制情绪并重视买入价，投资才可能胜出。"],
  ["On the Couch","投资者认为理所当然的事情，常常受心理偏差左右。"],
  ["What Does the Market Know?","短期价格更可能反映情绪变化，不能当成无偏见的建议。"],
  ["This Time It’s Different","行情火热时，先检验支持高估值的‘这次不同’是否成立。"],
  ["You Bet!","好决策也可能短期亏损，坏决策也可能碰巧赚钱。"],
  ["Uncertainty","人人都知道的宏观信息，很难成为自己的独特优势。"],
  ["Uncertainty II","识别真正可靠的预测者，本身也是艰难的判断。"],
  ["Something of Value","价值与成长不必截然对立，寻找合理价格的优秀企业也是价值判断。"],
  ["I Beg to Differ","要胜过多数人，仅仅判断正确还不够，还要比多数人判断得更好。"],
  ["The Illusion of Knowledge","宏观预测需要同时猜对许多变量，应谨慎对待精确结论。"],
  ["What Really Matters?","关键是相对承担风险得到更好的回报，而非追逐短期波动。"],
  ["Sea Change","投资环境发生结构变化时，也要重新审视旧策略的前提。"],
  ["Taking the Temperature","市场心理极端时，可以据此调整组合承担的风险。"],
  ["Fewer Losers, or More Winners?","信用投资更应重视控制亏损，但风险控制不等于完全回避风险。"],
  ["The Indispensability of Risk","承担风险并不自动带来高回报，承担方式还须有判断力。"],
  ["Ruminating on Asset Allocation","股票与债务的收益承诺和不确定性不同，配置时需匹配自身风险承受力。"],
  ["The Calculus of Value","长期价值增长是价格的重要支撑，买入时价格与价值的关系影响后续回报。"]
];

const originalQuotes: InvestorQuote[] = [
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

export const investorQuotes: InvestorQuote[] = [
  ...originalQuotes,
  ...marksHighlights.map(([locator,text],index)=>({id:originalQuotes.length+index+1,
    author:"霍华德·马克斯",text,source:"橡树资本《The Best of…》备忘录索引",locator,url:marks})),
  ...buffettManualHighlights.map(([locator,text],index)=>({id:originalQuotes.length+marksHighlights.length+index+1,
    author:"沃伦·巴菲特",text,source:"伯克希尔《股东手册》（1996）",locator,url:ownersManual})),
  ...smithHighlights.map(([locator,text],index)=>({id:originalQuotes.length+marksHighlights.length+buffettManualHighlights.length+index+1,
    author:"特里·史密斯",text,source:"Fundsmith Equity Fund Owner's Manual",locator,url:fundsmithManual}))
];

export function quoteIndexAt(timestampMs: number): number {
  return Math.floor((timestampMs + 8 * 60 * 60 * 1000) / 86_400_000) % investorQuotes.length;
}
