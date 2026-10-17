import {marginAssert as check,validMarginDate} from '../lib/margin.ts';
export const emUrl=(market,page=1,start='2023-08-01',size=500)=>{
  const url=new URL('https://datacenter-web.eastmoney.com/api/data/v1/get');
  for(const [key,value] of Object.entries({reportName:'RPTA_WEB_RZRQ_LSSH',columns:'ALL',source:'WEB',client:'WEB',
    sortColumns:'DIM_DATE',sortTypes:'-1',pageNumber:page,pageSize:size,
    filter:`(SCDM=${market==='sh'?'007':'001'})(DIM_DATE>='${start}')`}))url.searchParams.set(key,String(value));
  return url.toString();
};
export const sseUrl=(start,end)=>{
  const url=new URL('https://query.sse.com.cn/marketdata/tradedata/queryMargin.do');
  for(const [k,v] of Object.entries({isPagination:'true',beginDate:start.replaceAll('-',''),endDate:end.replaceAll('-',''),
    'pageHelp.pageSize':'5000','pageHelp.pageNo':'1'}))url.searchParams.set(k,v);
  return url.toString();
};
export const szseUrl=date=>{
  const url=new URL('https://www.szse.cn/api/report/ShowReport/data');
  url.searchParams.set('SHOWTYPE','JSON');url.searchParams.set('CATALOGID','1837_xxpl');
  url.searchParams.set('tab1PAGENO','1');if(date)url.searchParams.set('txtDate',date);
  return url.toString();
};
const number=value=>{check(value!==null&&value!==''&&value!==undefined,'amount missing');const n=Number(String(value).replaceAll(',',''));check(Number.isFinite(n)&&n>=0,'amount malformed');return n;};
export function parseEm(payload,market){
  check(payload.success===true&&Array.isArray(payload.result?.data),'Eastmoney financing response invalid');
  const rows=payload.result.data.map(r=>{
    check(r.SCDM===(market==='sh'?'007':'001'),'unexpected financing exchange');
    const date=String(r.DIM_DATE).slice(0,10);check(validMarginDate(date),'Eastmoney date invalid');
    return {date,venue:{balance:number(r.RZYE),buy:number(r.RZMRE),repay:number(r.RZCHE),short:number(r.RQYE),total:number(r.RZRQYE)}};
  });
  check(rows.length>0&&new Set(rows.map(r=>r.date)).size===rows.length,'empty or duplicate financing dates');
  return {rows,pages:payload.result.pages,count:payload.result.count};
}
export function parseSse(payload){
  check(Array.isArray(payload.result)&&payload.result.length>0,'SSE financing response empty');
  check(payload.pageHelp?.total===undefined||payload.pageHelp.total===payload.result.length,'SSE financing history truncated');
  return new Map(payload.result.map(r=>{const d=String(r.opDate),date=`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
    check(validMarginDate(date),'SSE financing date invalid');
    return [date,{balance:number(r.rzye),buy:number(r.rzmre),repay:number(r.rzche),short:number(r.rqylje),total:number(r.rzrqjyzl)}];}));
}
export function parseSzse(payload,requested){
  const table=payload?.[0],date=table?.metadata?.subname,cols=table?.metadata?.cols,r=table?.data?.[0];
  check(validMarginDate(date)&&(!requested||date===requested),'SZSE financing date mismatch');
  check(table.metadata.catalogid==='1837_xxpl'&&table.data.length===1&&cols,'SZSE summary missing');
  const read=key=>{const label=cols[key];check(typeof label==='string'&&/元/.test(label),'SZSE amount unit unknown');
    return number(r[key])*(label.includes('亿元')?1e8:label.includes('万元')?1e4:1);};
  // SZSE currently truncates amounts to 0.01 yi, rather than rounding to nearest.
  const tolerance=Object.values(cols).some(v=>String(v).includes('亿元'))?1000000:1;
  return {date,venue:{balance:read('jrrzye'),buy:read('jrrzmr'),short:read('jrrjye'),total:read('jrrzrjye')},tolerance};
}
export function matchVenue(actual,expected,tolerance=1){
  for(const field of ['balance','buy','short','total'])check(Math.abs(actual[field]-expected[field])<=tolerance,`official financing mismatch: ${field}, provider=${actual[field]}, official=${expected[field]}, tolerance=${tolerance}`);
}
export function parseStockTurnover(raw,symbol){
  const at=raw.indexOf('={');check(at>=0,'Tencent financing denominator response invalid');
  const body=JSON.parse(raw.slice(at+1).replace(/;\s*$/,'')),data=body.data?.[symbol],bars=data?.day??data?.qfqday;
  check(Array.isArray(bars)&&bars.length>=22,'Tencent stock turnover history insufficient');
  const map=new Map();
  for(const bar of bars){check(validMarginDate(bar[0]),'Tencent turnover date invalid');const amount=number(bar[8])*10000;
    check(amount>1e10&&amount<1e14,'Tencent turnover unit invalid');check(!map.has(bar[0]),'duplicate Tencent date');map.set(bar[0],amount);}
  return map;
}
export function assertMarginCalendar(dates,shTurnover,szTurnover,start,end){
  for(const date of shTurnover.keys())if(date>=start&&date<=end&&szTurnover.has(date))
    check(dates.has(date),`missing financing trading session ${date}`);
}
export function inferredRepayment(previous,venue){
  const repay=previous.balance+venue.buy-venue.balance;
  check(Number.isFinite(repay)&&repay>=0,'inferred repayment invalid');
  return {...venue,reportedRepay:venue.repay,repay,repayInferred:true};
}
