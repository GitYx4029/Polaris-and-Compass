// Deterministic, public HTTP failover. A transport outage never weakens numeric checks.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {marginAssert as check,validMarginDate,marginSources} from '../lib/margin.ts';
import {matchVenue} from './margin-adapters.mjs';

export class SourceUnavailable extends Error {
  constructor(message,options){super(message,options);this.name='SourceUnavailable';this.code='SOURCE_UNAVAILABLE';}
}
export function createMarginRequest({count=()=>{},fetchImpl=fetch,curl=promisify(execFile)}={}){
  return async url=>{
    const host=new URL(url).hostname,exchange=['www.szse.cn','query.sse.com.cn'].includes(host);
    const referer=host.includes('szse')?'https://www.szse.cn/':host.includes('sse')?'https://www.sse.com.cn/':host==='ds.emoney.cn'?marginSources.backup:'https://data.eastmoney.com/';
    const failures=[];
    for(let attempt=0;attempt<(exchange?1:2);attempt++)try{
      count();const response=await fetchImpl(url,{headers:{'User-Agent':'Mozilla/5.0',Accept:'application/json,text/html,*/*',Referer:referer},signal:AbortSignal.timeout(exchange?6500:10000)});
      if(!response.ok)throw Error(`HTTP ${response.status}`);
      const bytes=await response.arrayBuffer();
      const text=new TextDecoder(host==='ds.emoney.cn'?'gb18030':'utf-8').decode(bytes);
      if(exchange)JSON.parse(text); // HTML error/challenge pages are not reports.
      return text;
    }catch(error){failures.push(String(error.cause??error));}
    // curl can reach the same public report when undici's TLS path fails.
    if(exchange)for(const protocol of ['https:','http:'])try{
      const target=new URL(url);target.protocol=protocol;count();
      const {stdout}=await curl('curl',['--ipv4','--fail','--silent','--show-error','--location','--max-time','8','--connect-timeout','4','--user-agent','Mozilla/5.0','--referer',referer,target.toString()],{maxBuffer:2_000_000,timeout:9000});
      JSON.parse(stdout);return stdout;
    }catch(error){failures.push(String(error.stderr??error.cause??error));}
    if(host==='ds.emoney.cn')try{
      count();const {stdout}=await curl('curl',['--ipv4','--fail','--silent','--show-error','--location','--max-time','10','--connect-timeout','4','--user-agent','Mozilla/5.0',url],{maxBuffer:2_000_000,timeout:11000,encoding:'buffer'});
      return new TextDecoder('gb18030').decode(stdout);
    }catch(error){failures.push(String(error.stderr??error.cause??error));}
    throw new SourceUnavailable(`${host}: ${failures.join(' | ')}`);
  };
}

const plain=value=>value.replace(/<[^>]*>/g,'').replace(/&nbsp;|&#160;/g,' ').trim();
export function parseEmoney(raw,market){
  check(market==='sh'||market==='sz','backup market invalid');
  const id=market==='sh'?'divSh':'divSz';
  const section=raw.match(new RegExp(`<div\\b[^>]*\\bid=["']${id}["'][^>]*>[\\s\\S]*?<table\\b[^>]*>([\\s\\S]*?)<\\/table>`,'i'));
  check(section,'Emoney exchange table missing');
  const headers=[...section[1].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(m=>plain(m[1]).replace(/\s/g,''));
  check(headers.length===7&&['融资余额(亿元)','融资买入额(亿元)','融券余额(亿元)','融资融券余额(亿元)'].every((h,i)=>headers[[1,2,4,6][i]]===h),'Emoney columns or units changed');
  const rows=new Map();let previous;
  for(const match of section[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
    const cells=[...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>plain(m[1]));
    if(!cells.length)continue;
    const date=cells[0];check(cells.length===7&&validMarginDate(date)&&(!previous||date<previous),'Emoney dates malformed or duplicated');
    const value=i=>{check(/^\d[\d,]*\.\d{2}$/.test(cells[i]),'Emoney amount malformed');return Number(cells[i].replaceAll(',',''))*1e8;};
    rows.set(date,{balance:value(1),buy:value(2),short:value(4),total:value(6)});previous=date;
  }
  check(rows.size>=2&&rows.size<=300,'Emoney history missing');return rows;
}
export function verifyBackup({backup,expected,date,prior,officialDates}){
  const anchor=[...officialDates].filter(d=>d<date&&backup.has(d)&&prior?.history.some(r=>r.date===d)).sort().at(-1);
  check(anchor,'Emoney backup lacks a previously official-verified same-market anchor');
  matchVenue(prior.history.find(r=>r.date===anchor).sz,backup.get(anchor),1e6);
  if(!backup.has(date))throw new SourceUnavailable(`Emoney has not published SZ ${date}; keep verified history`);
  matchVenue(expected,backup.get(date),1e6);
  return anchor;
}
