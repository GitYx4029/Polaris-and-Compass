import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {collectMargin} from './collect-margin.mjs';
import {runMarginCollection} from './run-margin-collection.mjs';
import {parseEmoney,verifyBackup,SourceUnavailable,createMarginRequest} from './margin-resilience.mjs';
import {validateMargin,marginSources} from '../lib/margin.ts';

const html=await fs.readFile(new URL('./fixtures/margin-emoney-sz.html',import.meta.url),'utf8');
const shHtml=await fs.readFile(new URL('./fixtures/margin-emoney-sh.html',import.meta.url),'utf8');
const backup=parseEmoney(html,'sz'),shBackup=parseEmoney(shHtml,'sh');
// Synthetic history ends at the exact values of the captured public source.
// The source fixtures are fixed, independent of the bot's rolling data file.
function seed(){
  const dates=[];let date=new Date('2026-10-28');
  while(dates.length<330){if(![0,6].includes(date.getUTCDay()))dates.unshift(date.toISOString().slice(0,10));date.setUTCDate(date.getUTCDate()-1);}
  const history=dates.map((date,i)=>{
    const venue=table=>{const last=table.get('2026-10-28'),balance=last.balance-(329-i)*1e6;return {...last,balance,total:balance+last.short,repay:last.buy-1e6};};
    return {date,sh:venue(shBackup),sz:venue(backup),stockTurnover:2e11,official:true};
  });
  return {schemaVersion:1,scope:'SH_SZ_SECURITIES',asOf:'2026-10-28',generatedAt:'2026-10-29T06:00:00.000Z',sourceDates:{sh:'2026-10-28',sz:'2026-10-28'},history,checks:{officialSh:30,officialSzDates:['2026-10-28'],requests:8,seconds:1,mode:'provider+official'}};
}
function nextRow(prior){const previous=prior.history.at(-1);return {date:'2026-10-29',sh:{...shBackup.get('2026-10-29'),repay:previous.sh.balance+shBackup.get('2026-10-29').buy-shBackup.get('2026-10-29').balance},sz:{...backup.get('2026-10-29'),repay:previous.sz.balance+backup.get('2026-10-29').buy-backup.get('2026-10-29').balance},stockTurnover:2e11};}
function source(prior,{szDown=false,badOfficial=false,badBackup=false}={}){
  const rows=[...prior.history.filter(r=>r.date<'2026-10-29'),nextRow(seed())],calls=[];
  return {calls,request:async raw=>{
    const url=new URL(raw);calls.push(raw);
    if(url.hostname==='datacenter-web.eastmoney.com'){
      const market=url.searchParams.get('filter').includes('007')?'sh':'sz';
      return JSON.stringify({success:true,result:{pages:1,count:rows.length,data:rows.slice().reverse().map(r=>({DIM_DATE:r.date,SCDM:market==='sh'?'007':'001',RZYE:r[market].balance,RZMRE:r[market].buy,RZCHE:r[market].repay,RQYE:r[market].short,RZRQYE:r[market].total}))}});
    }
    if(url.hostname==='query.sse.com.cn')return JSON.stringify({result:rows.map(r=>({opDate:r.date.replaceAll('-',''),rzye:r.sh.balance,rzmre:r.sh.buy,rzche:r.sh.repay,rqylje:r.sh.short,rzrqjyzl:r.sh.total}))});
    if(url.hostname==='www.szse.cn'){
      if(szDown)throw new SourceUnavailable('injected exchange timeout');
      const date=url.searchParams.get('txtDate'),v=rows.find(r=>r.date===date).sz;
      return JSON.stringify([{metadata:{subname:date,catalogid:'1837_xxpl',cols:{jrrzye:'融资余额(元)',jrrzmr:'融资买入额(元)',jrrjye:'融券余额(元)',jrrzrjye:'融资融券余额(元)'}},data:[{jrrzye:v.balance,jrrzmr:v.buy+(badOfficial?2e6:0),jrrjye:v.short,jrrzrjye:v.total}]}]);
    }
    if(raw===marginSources.backup)return badBackup?html.replace('535.38','535.40'):html;
    if(url.hostname==='proxy.finance.qq.com'){
      const symbol=url.searchParams.get('param').split(',')[0];
      return 'x='+JSON.stringify({data:{[symbol]:{day:rows.map(r=>[r.date,0,0,0,0,0,{},0,1e7])}}});
    }
    throw Error(`Unexpected fixture URL: ${raw}`);
  }};
}
async function temporary(fn){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'margin-resilience-'));try{const prior=seed();validateMargin(prior);await fs.writeFile(path.join(directory,'margin.json'),JSON.stringify(prior)+'\n');await fn(directory,prior);}finally{await fs.rm(directory,{recursive:true,force:true});}}
const read=directory=>fs.readFile(path.join(directory,'margin.json'),'utf8').then(JSON.parse);
const now=new Date('2026-10-30T07:00:00Z');

test('real HTML fixtures: distinct SH/SZ scope, exact dates and 亿元 units',()=>{
  assert.equal(backup.get('2026-10-29').balance,11309.64e8);
  assert.equal(shBackup.get('2026-10-29').balance,12181.89e8);
  assert.throws(()=>parseEmoney(html.replaceAll('亿元','万元'),'sz'),/units/);
  assert.throws(()=>parseEmoney(html.replace('2026-10-29','2026-10-28'),'sz'),/dates/);
  assert.throws(()=>parseEmoney(html.replace('divSz','divAll'),'sz'),/table missing/);
  assert.throws(()=>parseEmoney(html.replace('535.38','--'),'sz'),/amount/);
  const prior=seed(),expected=nextRow(prior).sz;
  assert.equal(verifyBackup({backup,expected,date:'2026-10-29',prior,officialDates:['2026-10-28']}),'2026-10-28');
  assert.throws(()=>verifyBackup({backup,expected,date:'2026-10-29',prior,officialDates:[]}),/anchor/);
  assert.throws(()=>verifyBackup({backup,expected,date:'2026-10-30',prior,officialDates:['2026-10-28']}),SourceUnavailable);
});
test('SZSE timeout: independent backup validates all fields; next run upgrades to official even without a new date',()=>temporary(async(directory,prior)=>{
  const offline=source(prior,{szDown:true});
  await collectMargin({directory,now,request:offline.request,forceFull:false});
  const peer=await read(directory);validateMargin(peer);
  assert.equal(peer.asOf,'2026-10-29');assert.equal(peer.history.at(-1).szVerification,'emoney');
  assert.deepEqual(peer.checks.backupSz.dates,['2026-10-29']);assert.equal(peer.checks.officialSzDates.includes('2026-10-29'),false);
  assert.equal(offline.calls.filter(u=>u===marginSources.backup).length,1);
  assert.equal(offline.calls.filter(u=>new URL(u).hostname==='www.szse.cn').length,1);
  const online=source(peer);await collectMargin({directory,now,request:online.request,forceFull:false});
  const restored=await read(directory);validateMargin(restored);
  assert.equal(restored.asOf,peer.asOf);assert.equal(restored.checks.backupSz,undefined);
  assert.equal(restored.history.at(-1).szVerification,'szse');
  assert.ok(restored.checks.officialSzDates.includes('2026-10-29'));
}));
test('official contradiction and backup contradiction both reject and preserve the original file',()=>temporary(async(directory,prior)=>{
  const original=await fs.readFile(path.join(directory,'margin.json'),'utf8');
  for(const options of [{badOfficial:true},{szDown:true,badBackup:true}]){
    const fake=source(prior,options);
    await assert.rejects(()=>collectMargin({directory,now,request:fake.request}),/mismatch/);
    assert.equal(await fs.readFile(path.join(directory,'margin.json'),'utf8'),original);
    if(options.badOfficial)assert.equal(fake.calls.includes(marginSources.backup),false);
  }
}));
test('two transport failures preserve all figures, date and verified timestamp, explicitly mark pending',()=>temporary(async(directory,prior)=>{
  let calls=0,waits=0;
  const result=await runMarginCollection({directory,collect:async()=>{calls++;throw new SourceUnavailable('offline');},wait:async ms=>{assert.equal(ms,15000);waits++;},now:()=>now});
  const pending=await read(directory);validateMargin(pending);
  assert.equal(calls,2);assert.equal(waits,1);assert.equal(result.pending,true);
  assert.equal(pending.generatedAt,prior.generatedAt);assert.equal(pending.asOf,prior.asOf);assert.deepEqual(pending.history,prior.history);
  assert.equal(pending.collection.state,'pending');
  let invalid=0;
  await assert.rejects(()=>runMarginCollection({directory,collect:async()=>{invalid++;throw Error('invalid amount');},wait:async()=>assert.fail('validation errors must not retry')}),/invalid amount/);
  assert.equal(invalid,1);
}));
test('snapshot validator rejects missing cross-source proof and unknown provider',()=>{
  const snapshot=seed(),row=nextRow(snapshot);snapshot.history.push({...row,szVerification:'emoney',official:false});snapshot.asOf=row.date;snapshot.sourceDates={sh:row.date,sz:row.date};
  assert.throws(()=>validateMargin(snapshot),/核验/);
  snapshot.checks.backupSz={provider:'emoney',url:marginSources.backup,dates:[row.date],anchorDate:'2026-10-28',toleranceYuan:1e6};
  validateMargin(snapshot);
  snapshot.checks.backupSz.provider='unknown';assert.throws(()=>validateMargin(snapshot),/来源/);
});
test('bounded transports: one Node request + two curl paths, and GB18030 backup decoding',async()=>{
  let requests=0,curls=0;
  const get=createMarginRequest({count:()=>requests++,fetchImpl:async()=>{throw Error('timeout');},curl:async()=>{curls++;throw Error('timeout');}});
  await assert.rejects(()=>get('https://www.szse.cn/api/report/ShowReport/data'),SourceUnavailable);
  assert.equal(requests,3);assert.equal(curls,2);
  const decode=createMarginRequest({fetchImpl:async()=>new Response(Uint8Array.from([0xbd,0xbb,0xd2,0xd7]))});
  assert.equal(await decode(marginSources.backup),'交易');
});
