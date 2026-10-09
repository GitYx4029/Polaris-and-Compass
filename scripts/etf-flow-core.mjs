// Provider rankings are subscription/redemption estimates. Their date is
// independent of the live quote date in the provider's table.
export const flowSourceUrl='https://fund.stockstar.com/etf/detail';
export const chartUrl='https://fund.stockstar.com/etf/data/GetBBChartDatas?count=20';
export const tableUrl='https://fund.stockstar.com/etf/data/GetBBTableDatas?type=gm&pagesize=2000&pageindex=';
const datePattern=/^\d{4}-\d{2}-\d{2}$/;
const codePattern=/^(?:1[56]\d{4}|5\d{5})$/;
export function check(ok,message){if(!ok)throw new Error(`ETF flows: ${message}`)}
export function validDate(date){return typeof date==='string'&&datePattern.test(date)&&
  Number.isFinite(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date;}
export function moneyYi(value){
  const match=String(value??'').replace(/,/g,'').trim().match(/^([-+]?\d+(?:\.\d+)?)(亿元|万元|元)$/);
  if(!match)return null;
  const amount=Number(match[1])*({'亿元':1,'万元':1e-4,'元':1e-8}[match[2]]);
  return Number.isFinite(amount)?amount:null;
}
export function parseRanking(raw,today){
  check(raw?.ret===0&&validDate(raw.time)&&raw.time<=today,'invalid ranking date/status');
  check(Array.isArray(raw.jlrnames)&&raw.jlrnames.length===20&&
    Array.isArray(raw.jlrvalues)&&raw.jlrvalues.length===20,'incomplete top 20');
  const seen=new Set();let previous=Infinity;
  const rows=raw.jlrnames.map((name,i)=>{
    const match=String(name).match(/^(.+)\((\d{6})\)$/);
    const text=String(raw.jlrvalues[i]);
    const amount=/^\d+(?:\.\d+)?$/.test(text)?Number(text):NaN;
    check(match&&codePattern.test(match[2])&&!seen.has(match[2]),'invalid/duplicate ETF code');
    check(Number.isFinite(amount)&&amount>0&&amount<=previous,'invalid net inflow/order');
    seen.add(match[2]);previous=amount;
    return {rank:i+1,code:match[2],rankingName:match[1],netInflowYi:amount};
  });
  return {date:raw.time,rows};
}
export function reconcileUniverse(ranking,pages){
  check(pages.length>0&&pages.every(p=>p.ret===0&&p.total===pages[0].total&&Array.isArray(p.data)),
    'table pages/status/count changed');
  const total=pages[0].total,all=pages.flatMap(p=>p.data);
  check(Number.isInteger(total)&&total>=500&&total<=5000&&all.length===total,'truncated ETF universe');
  const byCode=new Map();
  for(const row of all){
    check(codePattern.test(row.FUND_CODE),'invalid universe code');
    check(validDate(row.TRADEDATE),'invalid provider quote date');
    const amount=moneyYi(row.NETIN_VALUE);
    check(amount!==null,'malformed net inflow in universe');
    const existing=byCode.get(row.FUND_CODE);
    if(existing){
      // One ETF can join two aliases of its tracked index. Only identical
      // financial records can be deduplicated; conflicting duplicates fail.
      check(['FUND_SNAME','FUND_NAME','TRADEDATE','NETIN_VALUE','VALUE'].every(key=>
        existing[key]===row[key]),'conflicting duplicate ETF records');
      continue;
    }
    byCode.set(row.FUND_CODE,{...row,netInflowYi:amount});
  }
  const sorted=[...byCode.values()].sort((a,b)=>b.netInflowYi-a.netInflowYi);
  check(sorted.filter(row=>row.netInflowYi>0).length>=20,'fewer than 20 inflows');
  const selected=new Set(ranking.rows.map(row=>row.code));
  const cutoff=ranking.rows.at(-1).netInflowYi;
  check(sorted.every(row=>selected.has(row.FUND_CODE)||row.netInflowYi<=cutoff+.015),
    'a larger inflow is omitted from the ranking');
  const rows=ranking.rows.map((row,i)=>{
    const detail=byCode.get(row.code);
    check(detail&&Math.abs(detail.netInflowYi-row.netInflowYi)<=.015&&
      Math.abs(sorted[i].netInflowYi-row.netInflowYi)<=.015,'ranking/table mismatch');
    check(typeof detail.FUND_SNAME==='string'&&detail.FUND_SNAME.length>0&&
      typeof detail.FUND_NAME==='string'&&detail.FUND_NAME.length>0,'missing ETF name');
    return {...row,name:detail.FUND_SNAME,fullName:detail.FUND_NAME,
      providerQuoteDate:detail.TRADEDATE,providerTurnoverYi:moneyYi(detail.VALUE)};
  });
  return {rows,total:byCode.size,providerRecords:total,deduplicated:total-byCode.size};
}
export function parseTurnover(payload,symbol,date){
  const data=payload?.data?.[symbol],quote=data?.qt?.[symbol];
  check(payload?.code===0&&Array.isArray(quote)&&quote[2]===symbol.slice(2)&&quote[61]==='ETF',
    `ETF identity mismatch ${symbol}`);
  const bars=data.day??data.qfqday;
  check(Array.isArray(bars),'missing daily turnover');
  const matches=bars.filter(bar=>bar[0]===date);
  check(matches.length===1,`turnover date unavailable ${symbol} ${date}`);
  const raw=String(matches[0][8]??'');
  const yuan10k=/^\d+(?:\.\d+)?$/.test(raw)?Number(raw):NaN;
  check(Number.isFinite(yuan10k)&&yuan10k>0&&yuan10k<1e11,`invalid turnover ${symbol}`);
  const turnoverYi=yuan10k/1e4;
  // For a same-day closed quote, check the independent amount field too.
  const stamp=String(quote[30]??'');
  if(stamp.startsWith(date.replaceAll('-',''))&&stamp.slice(8,12)>='1500'){
    const yuan=Number(String(quote[35]??'').split('/')[2]);
    check(Number.isFinite(yuan)&&yuan>0&&Math.abs(turnoverYi-yuan/1e8)<=Math.max(.02,turnoverYi*.005),
      `daily/quote turnover mismatch ${symbol}`);
  }
  return turnoverYi;
}
export function validateFlowSnapshot(snapshot,today){
  check(snapshot?.schemaVersion===1&&validDate(snapshot.asOf)&&snapshot.asOf<=today,'snapshot date/schema');
  check(Number.isFinite(Date.parse(snapshot.generatedAt))&&snapshot.source==='证券之星 ETF 数据宝'&&
    snapshot.sourceUrl===flowSourceUrl,'snapshot provenance');
  check(snapshot.universeCount>=500&&snapshot.checks?.rankingMatched===20&&
    snapshot.checks?.turnoverDateMatched===20&&snapshot.checks?.fundTypeConfirmed===20,
    'snapshot checks incomplete');
  check(/^[a-f0-9]{64}$/.test(snapshot.rankingDigest??'')&&
    Array.isArray(snapshot.rows)&&snapshot.rows.length===20,'snapshot rows/digest');
  let previous=Infinity;const seen=new Set();
  for(const [i,row] of snapshot.rows.entries()){
    check(row.rank===i+1&&codePattern.test(row.code)&&!seen.has(row.code),'snapshot rank/code');
    check(typeof row.name==='string'&&row.name.length>0&&typeof row.fullName==='string'&&
      row.fullName.length>0,'snapshot names');
    check(typeof row.netInflowYi==='number'&&Number.isFinite(row.netInflowYi)&&
      row.netInflowYi>0&&row.netInflowYi<=previous,'snapshot inflow/order');
    check(typeof row.turnoverYi==='number'&&Number.isFinite(row.turnoverYi)&&row.turnoverYi>0&&
      row.turnoverDate===snapshot.asOf,'snapshot turnover date/value');
    check(validDate(row.providerQuoteDate)&&typeof row.turnoverSourceUrl==='string'&&
      row.turnoverSourceUrl.startsWith('https://proxy.finance.qq.com/'),'snapshot turnover provenance');
    previous=row.netInflowYi;seen.add(row.code);
  }
  return snapshot;
}
