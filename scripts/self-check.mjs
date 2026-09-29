// Deterministic regression checks for the client parser, rolling figures and
// Beijing refresh schedule. Runs without remote APIs, credentials, or AI.
import assert from 'node:assert/strict';
import {parseTencent,composeDays} from '../lib/market.ts';
import {isCloseConfirmed,nextScheduledRefresh} from '../lib/refreshSchedule.ts';
import {alignedQuoteDates,unchangedClosedSession,alreadyVerifiedClose} from './market-session.mjs';
import {parseEastmoneyStar,parseTencentStarBatches,starFallback} from './star-fallback.mjs';
import {summarizeStar,summarizeEtf} from '../lib/browserDetail.ts';

const bars=Array.from({length:21},(_,i)=>{
  const date=new Date(Date.UTC(2026,6,1+i)).toISOString().slice(0,10);
  const row=Array(9).fill('0');row[0]=date;row[8]=String(70_000_000+i*10_000);
  return row;
});
const last=bars.at(-1)[0];
const quote=Array(36).fill('');
quote[30]=last.replaceAll('-','')+'160000';
quote[35]=`0/0/${(70_000_000+20*10_000)*10_000}`;
const parsed=parseTencent({data:{sh000001:{day:bars,qt:{sh000001:quote}}}},'sh000001');
assert.equal(parsed.amounts.get(last),7020);
assert.equal(parsed.quoteAt,`${last} 16:00`);
const bad=[...quote];bad[35]='0/0/900000000000';
assert.throws(()=>parseTencent({data:{sh000001:{day:bars,qt:{sh000001:bad}}}},'sh000001'),/不一致/);
const days=composeDays(bars.map((bar,i)=>({date:bar[0],sh:7000+i,sz:8000+i})));
assert.equal(days[18].roll20,undefined);
assert.equal(days[19].roll20,20*15000+2*190);
assert.equal(days[20].avg20,15021);
assert.equal(days[20].heat,(15000+40)/15021);
assert.equal(nextScheduledRefresh(Date.parse('2026-09-28T03:59:00Z')),60_000);
assert.equal(nextScheduledRefresh(Date.parse('2026-09-28T04:00:00Z')),(3*60+15)*60_000);
assert.equal(nextScheduledRefresh(Date.parse('2026-09-28T07:15:00Z')),40*60_000);
assert.equal(nextScheduledRefresh(Date.parse('2026-09-28T09:55:00Z')),60*60_000);
assert.equal(isCloseConfirmed('2026-09-28',['2026-09-28 15:00','2026-09-28 15:00'],Date.parse('2026-09-28T07:14:00Z')),false);
assert.equal(isCloseConfirmed('2026-09-28',['2026-09-28 15:00','2026-09-28 15:00'],Date.parse('2026-09-28T07:15:00Z')),true);
assert.equal(isCloseConfirmed('2026-09-28',['2026-09-28 15:00','2026-09-24 16:14'],Date.parse('2026-09-28T07:15:00Z')),false);
const prior={asOf:'2026-09-24',generatedAt:'2026-09-24T08:15:00Z',
  quoteAt:['2026-09-24 16:14','2026-09-24 16:14'],
  history:[{date:'2026-09-24',sh:7836.13,sz:8697.44,
  star:2457.81,starSource:'上海证券交易所分类成交',etf:4786.46,
  etfSource:'腾讯财经全代码段报价',etfCount:1500}]};
assert.equal(unchangedClosedSession('2026-09-24','2026-09-28',prior,7836.13,8697.44),true);
assert.equal(unchangedClosedSession('2026-09-24','2026-09-28',prior,7836.13,8698),false);
assert.equal(unchangedClosedSession('2026-09-24','2026-09-28',
  {...prior,history:[{...prior.history[0],star:undefined}]},7836.13,8697.44),false);
assert.equal(unchangedClosedSession('2026-09-28','2026-09-28',prior,1,1),false);
const verified={asOf:'2026-09-29',generatedAt:'2026-09-29T09:20:00Z',
  quoteAt:['2026-09-29 15:15','2026-09-29 15:15'],history:[{date:'2026-09-29',sh:1,sz:2,
    star:0.5,starSource:'上海证券交易所分类成交',etf:0.4,
    etfSource:'腾讯财经全代码段报价',etfCount:600}]};
assert.equal(alreadyVerifiedClose('2026-09-29','2026-09-29',verified,1,2),true);
assert.equal(alreadyVerifiedClose('2026-09-29','2026-09-29',verified,1,3),false);
assert.equal(alreadyVerifiedClose('2026-09-29','2026-09-29',
  {...verified,history:[{...verified.history[0],starSource:'腾讯财经科创板代码成交额'}]},1,2),false);
assert.equal(alignedQuoteDates('2026-09-28','20260928113000','20260928113000'),true);
assert.equal(alignedQuoteDates('2026-09-28','20260928113000','20260924161400'),false);
const codes=[...Array.from({length:614},(_,i)=>`688${String(i).padStart(3,'0')}`),'688981'];
const stamp=Date.parse('2026-09-28T07:15:00Z')/1000;
const emRows=codes.map(code=>({f12:code,f13:1,f6:200_000_000,f124:stamp}));
assert.equal(parseEastmoneyStar({data:{total:615,diff:emRows}},'2026-09-28',7000).amount,1230);
const qqQuote=code=>{const fields=Array(62).fill('');fields[1]='测试股票';fields[2]=code;
  fields[30]='20260928151500';fields[35]='1/1/200000000';fields[57]='20000';fields[61]='GP-A';
  return `v_sh${code}="${fields.join('~')}";`;};
const batch=[[codes,codes.map(qqQuote).join('')]];
assert.equal(parseTencentStarBatches(batch,'2026-09-28',7000).amount,1230);
assert.throws(()=>parseTencentStarBatches(batch,'2026-09-24',7000),/coverage/);
assert.throws(()=>parseEastmoneyStar({data:{total:615,diff:emRows.slice(1)}},'2026-09-28',7000),/coverage/);
let transient=true,firstBatchAttempts=0;
const backup=await starFallback('2026-09-28',7000,async url=>{
  if(url.hostname.includes('eastmoney'))throw new Error('provider unavailable');
  const requested=url.searchParams.get('q').split(',').map(code=>code.slice(2));
  if(requested.includes('688000')){
    firstBatchAttempts++;
    if(transient){transient=false;throw new Error('temporary network failure')}
  }
  return requested.filter(code=>codes.includes(code)||code==='688981').map(qqQuote).join('');
});
assert.equal(backup.amount,1230);
assert.equal(firstBatchAttempts,2);
const browserQuote=(code,kind='ETF')=>{const fields=Array(62).fill('');
  fields[1]='测试证券';fields[2]=code.slice(2);fields[30]='20260929151500';
  fields[35]='0/0/200000000';fields[57]='20000';fields[61]=kind;
  return fields.join('~');};
const starSymbols=[...Array.from({length:614},(_,i)=>`sh688${String(i).padStart(3,'0')}`),'sh688981'];
const starQuotes=new Map(starSymbols.map(symbol=>[symbol,browserQuote(symbol,'GP-A')]));
assert.equal(summarizeStar([{requested:starSymbols,quotes:starQuotes}], '2026-09-29',7000).star,1230);
assert.throws(()=>summarizeStar([{requested:starSymbols,quotes:new Map([...starQuotes].filter(([symbol])=>symbol!=='sh688981'))}],
  '2026-09-29',7000),/不完整/);
const etfSymbols=[...Array.from({length:10000},(_,i)=>`sh${500000+i*10}`),
  ...Array.from({length:2000},(_,i)=>`sz${158000+i}`)];
const etfQuotes=new Map([['sh510300',browserQuote('sh510300')],
  ...etfSymbols.slice(0,350).map(symbol=>[symbol,browserQuote(symbol)]),
  ...etfSymbols.slice(-250).map(symbol=>[symbol,browserQuote(symbol)])]);
const recoveredEtf=summarizeEtf([{requested:etfSymbols,quotes:etfQuotes}], '2026-09-29',20);
assert.equal(recoveredEtf.etfCount,601);
assert.equal(Math.round(recoveredEtf.etf),1202);
assert.throws(()=>summarizeEtf([{requested:etfSymbols.slice(1),quotes:etfQuotes}], '2026-09-29',20),/覆盖/);
const mismatched=new Map(etfQuotes);mismatched.set('sh500000',browserQuote('sh500000').replace('200000000','100000000'));
assert.throws(()=>summarizeEtf([{requested:etfSymbols,quotes:mismatched}], '2026-09-29',20),/交叉核对/);
console.log('self-check: Tencent amount/date, mismatched close, rolling20, Beijing schedule, stale-session skip and quote alignment');
