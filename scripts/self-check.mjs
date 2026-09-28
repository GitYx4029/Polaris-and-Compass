// Deterministic regression checks for the client parser, rolling figures and
// Beijing refresh schedule. Runs without remote APIs, credentials, or AI.
import assert from 'node:assert/strict';
import {parseTencent,composeDays} from '../lib/market.ts';
import {nextScheduledRefresh} from '../lib/refreshSchedule.ts';
import {alignedQuoteDates,unchangedClosedSession} from './market-session.mjs';

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
const prior={asOf:'2026-09-24',history:[{date:'2026-09-24',sh:7836.13,sz:8697.44}]};
assert.equal(unchangedClosedSession('2026-09-24','2026-09-28',prior,7836.13,8697.44),true);
assert.equal(unchangedClosedSession('2026-09-24','2026-09-28',prior,7836.13,8698),false);
assert.equal(unchangedClosedSession('2026-09-28','2026-09-28',prior,1,1),false);
assert.equal(alignedQuoteDates('2026-09-28','20260928113000','20260928113000'),true);
assert.equal(alignedQuoteDates('2026-09-28','20260928113000','20260924161400'),false);
console.log('self-check: Tencent amount/date, mismatched close, rolling20, Beijing schedule, stale-session skip and quote alignment');
