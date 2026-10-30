// Public HTTP data + deterministic arithmetic only. No browser, account or LLM.
import fs from 'node:fs/promises';
import path from 'node:path';
import {setDefaultResultOrder} from 'node:dns';
import {marginAssert as check,validateMargin,marginSources} from '../lib/margin.ts';
import {emUrl,sseUrl,szseUrl,parseEm,parseSse,parseSzse,matchVenue,parseStockTurnover,assertMarginCalendar,inferredRepayment} from './margin-adapters.mjs';
import {pathToFileURL} from 'node:url';
import {SourceUnavailable,createMarginRequest,parseEmoney,verifyBackup} from './margin-resilience.mjs';
export async function collectMargin({request,directory=path.resolve(process.env.MARGIN_OUTPUT_DIR??'public/data'),now=new Date(),forceFull=process.env.MARGIN_FULL==='1',exchangeOnly=process.env.MARGIN_EXCHANGE_ONLY==='1'}={}){
const started=performance.now(),today=new Date(+now+8*3600000).toISOString().slice(0,10);
setDefaultResultOrder('ipv4first');
const file=path.join(directory,'margin.json');
let prior=null,requests=0;
try{prior=JSON.parse(await fs.readFile(file,'utf8'));validateMargin(prior,today);}catch(e){if(e.code!=='ENOENT')throw e;}
const sameVenue=(a,b)=>a&&b&&['balance','buy','repay','short','total'].every(k=>a[k]===b[k]);
const shift=(date,n)=>new Date(Date.parse(date)+n*86400000).toISOString().slice(0,10);
const historyStart=new Date(today);historyStart.setUTCFullYear(historyStart.getUTCFullYear()-3);
const start=shift(historyStart.toISOString().slice(0,10),-65);
const full=!prior||forceFull||now.getUTCDay()===1&&prior.generatedAt.slice(0,10)!==now.toISOString().slice(0,10);
const get=request?async url=>{requests++;return request(url);}:createMarginRequest({count:()=>requests++});
async function em(market){
  const from=full?start:shift(prior.asOf,-45);
  const first=parseEm(JSON.parse(await get(emUrl(market,1,from))),market),rows=[...first.rows];
  check(Number.isInteger(first.pages)&&first.pages>=1&&first.pages<=4,'unexpected financing pagination');
  const rest=await Promise.all(Array.from({length:first.pages-1},(_,i)=>get(emUrl(market,i+2,from))));
  for(const raw of rest)rows.push(...parseEm(JSON.parse(raw),market).rows);
  check(rows.length===first.count&&new Set(rows.map(r=>r.date)).size===rows.length,'financing page truncated or duplicated');
  return new Map(rows.map(r=>[r.date,r.venue]));
}
let sh,sz,officialSh,officialSzDates=[...prior?.checks.officialSzDates??[]],mode='provider+official';
const backupDates=new Set(prior?.checks.backupSz?.dates??[]);
let backupAnchor=prior?.checks.backupSz?.anchorDate;
try{if(exchangeOnly)throw new SourceUnavailable('explicit exchange-only recovery');[sh,sz]=await Promise.all([em('sh'),em('sz')]);}
catch(providerError){
  if(!(providerError instanceof SourceUnavailable)||!prior)throw providerError;
  // Exchange-only recovery does not depend on Eastmoney. SZSE publishes rounded
  // balances; inferred repayment is explicitly labelled in the snapshot mode.
  mode='official-fallback-inferred';
  officialSh=parseSse(JSON.parse(await get(sseUrl(shift(prior.asOf,-5),today))));
  // An empty SZSE query defaults to today's calendar date, even on a weekend.
  // Probe explicit SSE trading dates; never accept a blank Saturday summary.
  let latest;
  for(const date of [...officialSh.keys()].sort().reverse().slice(0,5))try{
    latest=parseSzse(JSON.parse(await get(szseUrl(date))),date);break;
  }catch(error){if(!(error instanceof SourceUnavailable))throw error;}
  if(!latest)throw new SourceUnavailable('no reachable SZSE report for exchange recovery');
  check(latest,'no published SZSE summary for exchange recovery');
  sh=new Map(prior.history.map(r=>[r.date,r.sh]));sz=new Map(prior.history.map(r=>[r.date,r.sz]));
  for(const [date,venue] of officialSh)if(date>prior.asOf)sh.set(date,venue);
  const missing=[...officialSh.keys()].filter(d=>d>prior.asOf&&d<=latest.date).sort();
  check(missing.length<=5,'exchange recovery gap too large; keep prior snapshot');
  for(const date of missing){
    const result=date===latest.date?latest:parseSzse(JSON.parse(await get(szseUrl(date))),date);
    const previousDate=[...sz.keys()].sort().at(-1);
    sh.set(date,inferredRepayment(sh.get(previousDate),officialSh.get(date)));
    sz.set(date,inferredRepayment(sz.get(previousDate),result.venue));
    officialSzDates.push(date);
  }
  if(!missing.length){return {asOf:prior.asOf,unchanged:true,mode,requests,seconds:(performance.now()-started)/1000};}
}
const shDate=[...sh.keys()].sort().at(-1),szDate=[...sz.keys()].sort().at(-1),asOf=shDate<szDate?shDate:szDate;
check(asOf<=today&&(!prior||asOf>=prior.asOf),'financing source date regressed or future');
const common=[...sh.keys()].filter(d=>d<=asOf&&sz.has(d)).sort();
check([...sh.keys()].filter(d=>d<=asOf&&!sz.has(d)).length===0&&[...sz.keys()].filter(d=>d<=asOf&&!sh.has(d)).length===0,'financing history has unmatched market dates');
if(prior&&!full&&!backupDates.size&&mode==='provider+official'&&asOf===prior.asOf&&common.every(date=>{
  const old=prior.history.find(r=>r.date===date);return old&&sameVenue(old.sh,sh.get(date))&&sameVenue(old.sz,sz.get(date));
})){if(prior.collection){delete prior.collection;await fs.writeFile(file+'.tmp',JSON.stringify(prior)+'\n');await fs.rename(file+'.tmp',file);}return {asOf,unchanged:true,requests,seconds:Number(((performance.now()-started)/1000).toFixed(2))};}
const checkedFrom=mode.includes('fallback')?shift(prior.asOf,-5):full?start:shift(asOf,-45);
if(!officialSh)officialSh=parseSse(JSON.parse(await get(sseUrl(checkedFrom,today))));
let officialCount=0;
for(const date of common){if(date<checkedFrom)continue;const official=officialSh.get(date);check(official,`missing official SH financing ${date}`);matchVenue(sh.get(date),official,1);officialCount++;}
if(mode==='provider+official'){
  // Reuse unchanged verified history. Verify every new/revised or pending date,
  // including dates between the last snapshot and the newest trading session.
  const changed=common.filter(date=>{const old=prior?.history.find(r=>r.date===date);
    return !old||!sameVenue(old.sz,sz.get(date));});
  const checkDates=prior?[...changed,...backupDates,asOf]:[common[0],common[Math.floor(common.length/2)],asOf];
  let unavailable=false,backup;
  for(const date of [...new Set(checkDates)].sort()){
    if(!sz.has(date))continue;
    // A forced history refresh need not invalidate unchanged official proof.
    if(!backupDates.has(date)&&prior?.checks.officialSzDates.includes(date)&&sameVenue(prior.history.find(r=>r.date===date)?.sz,sz.get(date)))continue;
    try{
      if(unavailable)throw new SourceUnavailable('SZSE circuit open for this collection');
      const official=parseSzse(JSON.parse(await get(szseUrl(date))),date);
      matchVenue(sz.get(date),official.venue,official.tolerance);
      officialSzDates.push(date);backupDates.delete(date);
    }catch(error){
      if(!(error instanceof SourceUnavailable))throw error;
      unavailable=true;
      backup??=parseEmoney(await get(marginSources.backup),'sz');
      const anchor=verifyBackup({backup,expected:sz.get(date),date,prior,officialDates:prior?.checks.officialSzDates??[]});
      backupAnchor=!backupAnchor||anchor<backupAnchor?anchor:backupAnchor;
      backupDates.add(date);
    }
  }
}
const turnover=await Promise.all(['sh000001','sz399001'].map(async symbol=>{
  const url=new URL('https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get');
  url.searchParams.set('_var',`margin_${symbol}`);url.searchParams.set('param',`${symbol},day,,,1000,qfq`);
  return parseStockTurnover(await get(url.toString()),symbol);
}));
const rows=new Map((prior?.history??[]).map(row=>[row.date,row]));
for(const date of common){const a=turnover[0].get(date),b=turnover[1].get(date);
  check(a&&b,`same-day stock turnover missing ${date}`);
  const peer=backupDates.has(date);
  rows.set(date,{date,sh:sh.get(date),sz:sz.get(date),stockTurnover:a+b,official:!peer,...(peer?{szVerification:'emoney'}:officialSzDates.includes(date)?{szVerification:'szse'}:{})});
}
const history=[...rows.values()].filter(r=>r.date>=start&&r.date<=asOf).sort((a,b)=>a.date.localeCompare(b.date));
// Tencent supplies the common equity trading calendar; never silently skip a
// missing financing session and then mislabel a 5/20-session statistic.
assertMarginCalendar(rows,turnover[0],turnover[1],history[0].date,asOf);
const snapshot={schemaVersion:1,asOf,generatedAt:now.toISOString(),scope:'SH_SZ_SECURITIES',sourceDates:{sh:shDate,sz:szDate},history,
  checks:{officialSh:officialCount,officialSzDates:[...new Set(officialSzDates)].sort(),requests,seconds:Number(((performance.now()-started)/1000).toFixed(2)),mode,
    ...(backupDates.size?{backupSz:{provider:'emoney',url:marginSources.backup,dates:[...backupDates].sort(),anchorDate:backupAnchor,toleranceYuan:1e6}}:{})}};
validateMargin(snapshot,today);
await fs.mkdir(directory,{recursive:true});await fs.writeFile(file+'.tmp',JSON.stringify(snapshot)+'\n');await fs.rename(file+'.tmp',file);
return {asOf,sessions:history.length,first:history[0].date,...snapshot.checks};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{console.log(JSON.stringify(await collectMargin()));}catch(error){console.error(error);process.exitCode=error instanceof SourceUnavailable?75:1;}
}
