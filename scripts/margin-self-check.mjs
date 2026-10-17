import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {validateMargin,validMarginDate,marginSeries,marginLadder,quantile} from '../lib/margin.ts';
import {parseEm,parseSse,parseSzse,matchVenue,parseStockTurnover,assertMarginCalendar,inferredRepayment} from './margin-adapters.mjs';
const fixture=JSON.parse(await fs.readFile(new URL('./fixtures/margin-sources.json',import.meta.url),'utf8'));
const sh=parseSse(fixture.sse).get('2026-10-16');
assert.equal(sh.balance,1258249948850);assert.equal(sh.buy,66923010429);assert.equal(sh.total,1276920650530);
const sz=parseSzse(fixture.szse,'2026-10-15');
assert.equal(sz.venue.balance,1200674000000);assert.equal(sz.venue.buy,55478000000);
const unitYuan=structuredClone(fixture.szse);unitYuan[0].metadata.cols.jrrzmr='融资买入额(元)';unitYuan[0].data[0].jrrzmr='55,478,000,000';
assert.equal(parseSzse(unitYuan).venue.buy,sz.venue.buy);
const repayment=fixture.sseRepaymentExample,official=parseSse({result:[repayment.current]}).get('2026-10-15');
const recovered=inferredRepayment({balance:repayment.previousBalance},official);
assert.equal(recovered.reportedRepay,official.repay);assert.equal(recovered.repayInferred,true);
assert.equal(repayment.previousBalance+recovered.buy-recovered.repay,recovered.balance);
assert.equal(Math.abs(recovered.reportedRepay-recovered.repay),9833156);
// The official table truncates to 0.01 yi. A 0.005 yi rounding tolerance is wrong.
const em=parseEm(fixture.emSz,'sz');assert.equal(em.rows[0].venue.buy,55478821703);
assert.doesNotThrow(()=>matchVenue(em.rows[0].venue,sz.venue,sz.tolerance));
assert.throws(()=>matchVenue({...em.rows[0].venue,buy:sz.venue.buy+1100000},sz.venue,sz.tolerance),/mismatch/);
assert.throws(()=>parseSzse(fixture.szse,'2026-10-16'),/date mismatch/);
assert.throws(()=>parseEm(fixture.emSz,'sh'),/exchange/);
const unknown=structuredClone(fixture.szse);unknown[0].metadata.cols.jrrzmr='amount';assert.throws(()=>parseSzse(unknown),/unit/);
assert.equal(validMarginDate('2026-02-30'),false);
const rows=[];let a=500e9,b=400e9;
for(let i=0;i<330;i++){
  a+=1e6;b+=2e6;const date=new Date(Date.UTC(2024,0,1+i)).toISOString().slice(0,10);
  rows.push({date,sh:{balance:a,buy:5e9,repay:5e9-1e6,short:1e9,total:a+1e9},
    sz:{balance:b,buy:4e9,repay:4e9-2e6,short:2e9,total:b+2e9},stockTurnover:1e12+i*1e9});
}
const snapshot={schemaVersion:1,scope:'SH_SZ_SECURITIES',asOf:rows.at(-1).date,generatedAt:'2025-01-01T00:00:00Z',
  sourceDates:{sh:rows.at(-1).date,sz:rows.at(-1).date},history:rows,
  checks:{officialSh:330,officialSzDates:[rows.at(-1).date],requests:8,seconds:1,mode:'test'}};
validateMargin(snapshot);const points=marginSeries(rows);
assert.equal(points[3].net5,undefined);assert.equal(points[4].net5,15e6);
assert.equal(points[18].net20,undefined);assert.equal(points[19].net20,60e6);
assert.equal(points[19].growth20,undefined);
assert.ok(Math.abs(points[20].growth20-((points[20].balance/points[0].balance-1)*100))<1e-10);
assert.equal(points.at(-1).streak,330);
const expected=rows.slice(0,20).reduce((s,r)=>s+9e9/r.stockTurnover*100,0)/20;
assert.equal(points[19].intensity20,expected);assert.equal(points[18].intensity20,undefined);
assert.equal(quantile([0,10,20,30,40],.2),8);
assert.equal(marginLadder(points,251,'balance'),null);
const before=marginLadder(points,300,'balance');assert.equal(before.count,300);
assert.equal(before.end,points[299].date);
const future=points.map(p=>({...p}));for(let i=301;i<future.length;i++)future[i].balance*=100;
assert.deepEqual(marginLadder(future,300,'balance'),before);
const bad=structuredClone(snapshot);bad.history[100].sh.balance+=2e6;assert.throws(()=>validateMargin(bad),/合计|勾稽/);
const wrongDate=structuredClone(snapshot);wrongDate.history[1].date=wrongDate.history[0].date;assert.throws(()=>validateMargin(wrongDate),/日期/);
const missed=new Map([['2026-10-14',1],['2026-10-15',1]]);
assert.throws(()=>assertMarginCalendar(new Set(['2026-10-15']),missed,missed,'2026-10-14','2026-10-15'),/missing financing/);
const bars=Array.from({length:22},(_,i)=>[rows[i].date,0,0,0,0,0,{},0,10000000+i]);
const denominator=parseStockTurnover('x='+JSON.stringify({data:{sh000001:{day:bars}}}),'sh000001');
assert.equal(denominator.get(rows[0].date),100000000000);
console.log('margin self-check: live source fixtures, unit changes, truncation, dates, identities, missing sessions, 5/20 windows, quantiles and no look-ahead');
