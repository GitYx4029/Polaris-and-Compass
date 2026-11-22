export type BasketEvidence={holder:string;asOf:string;publishedAt:string;url:string;shares?:number;page?:string};
export type BasketFund={code:string;name:string;category:string;group:"core"|"extended";inception:string;firstShareDate?:string;evidence?:BasketEvidence[]};
export type BasketRow=[string,(number|null)[],(number|null)[]];
export type BasketSnapshot={schemaVersion:1;asOf:string;generatedAt:string;poolVersion:string;referenceUrl:string;funds:BasketFund[];rows:BasketRow[];
  sources:{sh:string;sz:string;nav:string;history?:string};
  checks:{requests:number;seconds:number;officialShDates:string[];officialSzDates:string[];historyMode:"official"|"archive-crosschecked";sampleChecks:number;navCorrections?:{code:string;date:string;value:number;sourceUrl:string}[];navConflicts?:{code:string;date:string;eastmoney:number;sina:number}[]};
  pending?:{checkedAt:string;reason:string}};
export type BasketPoint={date:string;net:number|null;scale:number|null;expected:number;valid:number;groups:Record<string,number|null>;flows:(number|null)[];rates:(number|null)[]};
export const basketAdjustments=[
  {code:"512100",date:"2022-09-02",factor:.36555,sourceUrl:"https://www.sse.com.cn/disclosure/fund/announcement/c/new/2022-09-05/512100_20220905_1_UJdHwEYe.pdf"},
  {code:"560010",date:"2022-09-13",factor:.35295,sourceUrl:"https://www.gffunds.com.cn/jjgg/zdsj/202209/t20220914_377871.shtml"},
  {code:"510310",date:"2024-09-20",factor:.49977589,sourceUrl:"https://www.sse.com.cn/disclosure/fund/announcement/c/new/2024-09-23/510310_20240923_G18B.pdf"},
  {code:"159922",date:"2024-11-29",factor:2.5,sourceUrl:"https://static.cninfo.com.cn/finalpage/2024-12-02/1221893545.PDF"},
  {code:"510100",date:"2025-03-07",factor:.49719902,sourceUrl:"https://www.sse.com.cn/disclosure/fund/announcement/c/new/2025-03-10/510100_20250310_F7LV.pdf"},
] as const;
export const basketAdjustment=(code:string,date:string)=>basketAdjustments.find(a=>a.code===code&&a.date===date);
export function basketAssert(value:unknown,message:string):asserts value{if(!value)throw Error(`ETF观察篮子：${message}`);}
export const basketDate=(v:unknown):v is string=>typeof v==="string"&&/^\d{4}-\d\d-\d\d$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export function validateBasket(value:unknown,today=new Date(Date.now()+8*3600000).toISOString().slice(0,10)):asserts value is BasketSnapshot{
  const x=value as BasketSnapshot;
  basketAssert(x?.schemaVersion===1&&basketDate(x.asOf)&&x.asOf<=today,"版本或统计日无效");
  basketAssert(Number.isFinite(Date.parse(x.generatedAt))&&Date.parse(x.generatedAt)<=Date.now()+300000,"核验时间无效");
  basketAssert(Array.isArray(x.funds)&&x.funds.length>=5&&x.funds.length<=60&&new Set(x.funds.map(f=>f.code)).size===x.funds.length,"观察池缺失或重复");
  basketAssert(typeof x.poolVersion==="string"&&!!x.poolVersion&&x.referenceUrl==="https://wwww1998.github.io/national-team-etf-flow/","观察池版本或出处缺失");
  for(const f of x.funds){basketAssert(/^(?:5\d{5}|15\d{4})$/.test(f.code)&&!!f.name&&!!f.category&&["core","extended"].includes(f.group)&&basketDate(f.inception),"基金代码、名称或起始日无效");
    if(f.evidence)for(const e of f.evidence)basketAssert(!!e.holder&&basketDate(e.asOf)&&basketDate(e.publishedAt)&&e.asOf<=e.publishedAt&&/^https?:\/\//.test(e.url),"持仓证据无效");}
  basketAssert(Array.isArray(x.rows)&&x.rows.length>=2&&x.rows.length<=1800,"历史长度异常");
  const n=x.funds.length;
  for(let i=0;i<x.rows.length;i++){const [d,q,v]=x.rows[i];basketAssert(basketDate(d)&&d<=x.asOf&&(!i||d>x.rows[i-1][0]),"日期重复、逆序或超前");
    basketAssert(q.length===n&&v.length===n,"基金覆盖数量错误");
    basketAssert(q.every(a=>a===null||Number.isFinite(a)&&a>=0&&a<1e13)&&v.every(a=>a===null||Number.isFinite(a)&&a>0&&a<10000),"份额或单位净值异常");}
  basketAssert(x.rows.at(-1)![0]===x.asOf,"末行日期不一致");
  basketAssert(x.sources?.sh?.includes("sse.com.cn")&&x.sources.sz?.includes("szse.cn")&&x.sources.nav?.includes("eastmoney.com"),"原始来源缺失");
  basketAssert(x.checks&&Number.isInteger(x.checks.requests)&&x.checks.requests>0&&Number.isFinite(x.checks.seconds)&&x.checks.seconds>=0&&["official","archive-crosschecked"].includes(x.checks.historyMode)&&x.checks.officialShDates.includes(x.asOf)&&x.checks.officialSzDates.includes(x.asOf),"缺少同日交易所份额核验");
  if(x.pending)basketAssert(basketDate(x.pending.checkedAt.slice(0,10))&&!!x.pending.reason,"补采状态无效");
  const last=basketSeries(x).at(-1)!;basketAssert(last.net!==null&&last.valid===last.expected,"最新交易日观察池未齐");
}
export function basketSeries(s:BasketSnapshot,group:"all"|"core"|"extended"="all"):BasketPoint[]{
  const ids=s.funds.map((f,i)=>({f,i})).filter(x=>group==="all"||x.f.group===group);
  return s.rows.map(([date,q,v],j)=>{
    const flows:(number|null)[]=s.funds.map(()=>null),rates:(number|null)[]=s.funds.map(()=>null),groups:Record<string,number|null>={};
    let net=0,scale=0,valid=0,expected=0,scaleCount=0,scaleExpected=0;
    for(const {f,i} of ids){if(f.inception>date||f.firstShareDate&&date<f.firstShareDate)continue;scaleExpected++;const prev=s.rows[j-1]?.[1][i],oldNav=s.rows[j-1]?.[2][i];
      if(q[i]!==null&&v[i]!==null){scale+=q[i]!*v[i]!;scaleCount++;}
      if(f.firstShareDate===date)continue; // Initial subscribed shares establish a baseline, not daily flow.
      expected++;
      let flow:number|null=null;
      if(j&&prev!==null&&prev!==undefined&&q[i]!==null&&v[i]!==null){
        const adjustment=basketAdjustment(f.code,date),adjustedPrevious=prev*(adjustment?.factor??1);
        const ratio=prev>0?q[i]!/prev:1,navRatio=oldNav?v[i]!/oldNav:1;
        const possibleSplit=Math.abs(ratio-1)>.3&&(ratio-1)*(navRatio-1)<0&&Math.abs(ratio*navRatio-1)<.03;
        if(!possibleSplit||adjustment){flow=(q[i]!-adjustedPrevious)*v[i]!;rates[i]=adjustedPrevious>0?(q[i]!/adjustedPrevious-1)*100:null;}
      }
      flows[i]=flow;if(flow!==null){net+=flow;valid++;}
      if(!(f.category in groups))groups[f.category]=0;
      groups[f.category]=groups[f.category]===null||flow===null?null:groups[f.category]!+flow;
    }
    return {date,net:expected>0&&valid===expected?net:null,scale:scaleExpected>0&&scaleCount===scaleExpected?scale:null,expected,valid,groups,flows,rates};
  });
}
export const basketWindows=[{key:"1m",label:"近1月",months:1},{key:"3m",label:"近3月",months:3},{key:"6m",label:"近半年",months:6},{key:"1y",label:"近1年",months:12},{key:"3y",label:"近3年",months:36},{key:"all",label:"全部",months:0}] as const;
export function basketRange(points:BasketPoint[],key:string,start?:string,end?:string){
  if(!points.length)return [];
  let last=end??points.at(-1)!.date,first=start;
  if(!first){const months=basketWindows.find(w=>w.key===key)?.months??0;if(months){const d=new Date(last);const target=d.getUTCMonth()-months;d.setUTCDate(1);d.setUTCMonth(target);const monthEnd=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(Number(last.slice(8)),monthEnd));first=d.toISOString().slice(0,10);}else first=points[0].date;}
  return points.filter(p=>p.date>=first!&&p.date<=last);
}
export function basketSum(points:BasketPoint[],days?:number):number|null{
  const selected=days?points.slice(-days):points;
  return !selected.length||days&&selected.length<days||selected.some(p=>p.net===null)?null:selected.reduce((sum,p)=>sum+p.net!,0);
}
export function basketCumulative(points:BasketPoint[]):(number|null)[]{
  let sum=0,gap=false;return points.map(p=>{if(p.net===null)gap=true;if(gap)return null;sum+=p.net!;return sum;});
}
