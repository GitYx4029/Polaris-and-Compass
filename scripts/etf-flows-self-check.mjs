import assert from 'node:assert/strict';
import {moneyYi,parseRanking,reconcileUniverse,parseTurnover,validateFlowSnapshot,
  flowSourceUrl} from './etf-flow-core.mjs';
assert.ok(Math.abs(moneyYi('8366.26万元')-.836626)<1e-12);
assert.equal(moneyYi('-2.45亿元'),-2.45);
assert.equal(moneyYi('0.00元'),0);
assert.equal(moneyYi('--'),null);
assert.equal(moneyYi('<span>2亿元</span>'),null);
const raw={ret:0,time:'2026-10-08',jlrnames:Array.from({length:20},(_,i)=>`ETF${i}(5${String(10000+i).padStart(5,'0')})`),
  jlrvalues:Array.from({length:20},(_,i)=>String(20-i))};
const ranking=parseRanking(raw,'2026-10-09');
assert.throws(()=>parseRanking({...raw,time:'2026-10-10'},'2026-10-09'),/date/);
assert.throws(()=>parseRanking({...raw,time:'2026-02-30'},'2026-10-09'),/date/);
assert.throws(()=>parseRanking({...raw,jlrnames:raw.jlrnames.slice(0,19)},'2026-10-09'),/incomplete/);
assert.throws(()=>parseRanking({...raw,jlrnames:[raw.jlrnames[0],...raw.jlrnames.slice(0,19)]},'2026-10-09'),/duplicate/);
const data=Array.from({length:500},(_,i)=>({FUND_CODE:`5${String(10000+i).padStart(5,'0')}`,
  FUND_SNAME:`ETF${i}`,FUND_NAME:`ETF full name ${i}`,NETIN_VALUE:`${i<20?20-i:0}亿元`,
  VALUE:'10.00亿元',TRADEDATE:'2026-10-09'}));
assert.equal(reconcileUniverse(ranking,[{ret:0,total:500,data}]).total,500);
assert.throws(()=>reconcileUniverse(ranking,[{ret:0,total:501,data}]),/truncated/);
assert.equal(reconcileUniverse(ranking,[{ret:0,total:501,data:[...data,{...data[0],INDEX_CODE:'alias'}]}]).total,500);
assert.throws(()=>reconcileUniverse(ranking,[{ret:0,total:501,data:[...data,{...data[0],NETIN_VALUE:'19亿元'}]}]),/conflicting duplicate/);
assert.throws(()=>reconcileUniverse(ranking,[{ret:0,total:500,data:data.map((r,i)=>i===499?{...r,NETIN_VALUE:'100亿元'}:r)}]),/omitted/);
assert.throws(()=>reconcileUniverse(ranking,[{ret:0,total:500,data:data.map((r,i)=>i===0?{...r,NETIN_VALUE:'18亿元'}:r)}]),/mismatch/);
const quote=[];quote[2]='510000';quote[61]='ETF';quote[30]='20261009161400';
const payload={code:0,data:{sh510000:{qfqday:[['2026-10-08',0,0,0,0,0,{},0,'123456.78']],qt:{sh510000:quote}}}};
assert.equal(parseTurnover(payload,'sh510000','2026-10-08'),12.345678);
assert.throws(()=>parseTurnover(payload,'sh510000','2026-10-09'),/date unavailable/);
const snapshot={schemaVersion:1,asOf:ranking.date,generatedAt:'2026-10-09T14:00:00Z',
  source:'证券之星 ETF 数据宝',sourceUrl:flowSourceUrl,universeCount:500,rankingDigest:'a'.repeat(64),
  checks:{rankingMatched:20,turnoverDateMatched:20,fundTypeConfirmed:20},
  rows:ranking.rows.map(row=>({...row,name:row.rankingName,fullName:row.rankingName,
    turnoverYi:12,turnoverDate:ranking.date,providerQuoteDate:'2026-10-09',
    turnoverSourceUrl:'https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get'}))};
validateFlowSnapshot(snapshot,'2026-10-09');
assert.throws(()=>validateFlowSnapshot({...snapshot,rows:snapshot.rows.map((r,i)=>i===0?{...r,turnoverDate:'2026-10-09'}:r)},'2026-10-09'),/turnover date/);
assert.throws(()=>validateFlowSnapshot({...snapshot,rows:snapshot.rows.slice(0,19)},'2026-10-09'),/rows/);
console.log('ETF flows self-check: units, future/invalid dates, duplicate codes, full coverage, omitted winners, provider mismatch and cross-day turnover');
