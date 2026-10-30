export type MarginVenue = {balance:number;buy:number;repay:number;short:number;total:number;reportedRepay?:number;repayInferred?:boolean};
export type MarginRow = {date:string;sh:MarginVenue;sz:MarginVenue;stockTurnover?:number;official?:boolean;szVerification?:"szse"|"emoney"};
export type MarginSnapshot = {
  schemaVersion:1;asOf:string;generatedAt:string;scope:"SH_SZ_SECURITIES";
  sourceDates:{sh:string;sz:string};history:MarginRow[];
  checks:{officialSh:number;officialSzDates:string[];requests:number;seconds:number;mode:string;
    backupSz?:{provider:"emoney";url:string;dates:string[];anchorDate:string;toleranceYuan:number}};
  collection?:{state:"pending";checkedAt:string;attempts:number;reason:"source_unavailable"};
};
export type MarginPoint = MarginRow & {balance:number;buy:number;repay:number;short:number;total:number;
  net:number;net5?:number;net20?:number;growth20?:number;intensity?:number;intensity20?:number;streak:number};
export type LadderKey = "balance"|"intensity20"|"growth20";
export const marginSources = {
  sh:"https://www.sse.com.cn/market/othersdata/margin/detail/",
  sz:"https://www.szse.cn/disclosure/margin/margin/index.html",
  em:"https://data.eastmoney.com/rzrq/total.html",
  backup:"https://ds.emoney.cn/DataCenter2/DataCenter/dzjy_rzrq",
  tencent:"https://gu.qq.com/sh000001/zs",
};
export const marginResearch = [
  {title:"光大证券 · 市场情绪，看不见的另一只手",date:"2023-09-04",page:"第 9—10 页",url:"https://pdf.dfcfw.com/pdf/H301_AP202309041597482155_1.pdf",note:"参考平滑值及历史分位；高融资参与度并不唯一对应顶部。"},
  {title:"国联期货 · 融资余额在指数择时中的应用",date:"2025-12-01",page:"第 3—4 页",url:"https://www.glqh.com/u/cms/www/202512/01143139mgu6.pdf",note:"融资变化可辅助观察趋势；报告内的历史回测不代表未来有效。"},
  {title:"德邦证券 · 寻找热门行业预警指标",date:"2022-08-29",page:"第 16 页",url:"https://pdf.dfcfw.com/pdf/H3_AP202208311577869537_1.pdf",note:"融资相对市值的峰值可能滞后于价格，不采用固定金额或 3% 作为买卖线。"},
];
export function marginAssert(condition:unknown,message:string):asserts condition {
  if(!condition)throw new Error(message);
}
export function validMarginDate(value:unknown):value is string {
  return typeof value==="string"&&/^\d{4}-\d\d-\d\d$/.test(value)&&
    Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
}
export function validateMargin(snapshot:unknown,today=new Date(Date.now()+8*3600000).toISOString().slice(0,10)):asserts snapshot is MarginSnapshot {
  const s=snapshot as MarginSnapshot;
  marginAssert(s?.schemaVersion===1&&s.scope==="SH_SZ_SECURITIES","融资数据版本或市场范围不符");
  marginAssert(validMarginDate(s.asOf)&&s.asOf<=today,"融资统计日期无效或在未来");
  marginAssert(Number.isFinite(Date.parse(s.generatedAt))&&Date.parse(s.generatedAt)<=Date.now()+300000,"融资核验时间无效");
  marginAssert(Array.isArray(s.history)&&s.history.length>=22&&s.history.length<=1300,"融资历史长度异常");
  marginAssert(validMarginDate(s.sourceDates?.sh)&&validMarginDate(s.sourceDates?.sz)&&s.asOf<=s.sourceDates.sh&&s.asOf<=s.sourceDates.sz&&s.sourceDates.sh<=today&&s.sourceDates.sz<=today,"沪深融资日期未对齐");
  for(let i=0;i<s.history.length;i++){
    const row=s.history[i];
    marginAssert(validMarginDate(row.date)&&row.date<=s.asOf&&(!i||row.date>s.history[i-1].date),"融资历史日期重复、逆序或超前");
    for(const venue of ["sh","sz"] as const){
      const v=row[venue];
      marginAssert(v&&[v.balance,v.buy,v.repay,v.short,v.total].every(x=>Number.isFinite(x)&&x>=0&&x<1e14),"融资金额缺失或单位异常");
      marginAssert(v.balance>1e10&&v.buy>1e8&&Math.abs(v.balance+v.short-v.total)<1e6,"融资、融券与两融合计不一致");
      if(i){const prev=s.history[i-1][venue];marginAssert(Math.abs(prev.balance+v.buy-v.repay-v.balance)<1e6,`融资余额与净买入未勾稽: ${row.date} ${venue}`);}
    }
    if(row.stockTurnover!==undefined)marginAssert(Number.isFinite(row.stockTurnover)&&row.stockTurnover>1e10&&row.stockTurnover<1e14,"同日成交额单位异常");
  }
  marginAssert(s.history.at(-1)!.date===s.asOf,"融资末行与统计日期不一致");
  marginAssert(s.checks?.officialSh>=1&&Array.isArray(s.checks.officialSzDates),"缺少交易所核验记录");
  const backup=s.checks.backupSz;
  if(backup){
    marginAssert(backup.provider==="emoney"&&backup.url===marginSources.backup&&backup.toleranceYuan===1e6&&Array.isArray(backup.dates)&&backup.dates.length>0&&new Set(backup.dates).size===backup.dates.length,"备用核验来源或精度无效");
    marginAssert(validMarginDate(backup.anchorDate)&&s.checks.officialSzDates.includes(backup.anchorDate)&&backup.dates.every(d=>validMarginDate(d)&&d>backup.anchorDate&&d<=s.asOf&&s.history.some(r=>r.date===d&&r.szVerification==="emoney")),"备用核验缺少官方历史锚点或对应日期");
  }
  marginAssert(s.checks.officialSzDates.includes(s.asOf)||!!backup?.dates.includes(s.asOf),"缺少同日交易所或独立来源交叉核验");
  marginAssert(s.history.every(r=>r.szVerification!=="emoney"||backup?.dates.includes(r.date)),"备用核验行缺少来源记录");
  marginAssert(s.checks.officialSzDates.every(validMarginDate)&&Number.isInteger(s.checks.requests)&&s.checks.requests>0&&Number.isFinite(s.checks.seconds)&&s.checks.seconds>=0&&typeof s.checks.mode==="string","融资核验记录无效");
  if(s.collection)marginAssert(s.collection.state==="pending"&&s.collection.reason==="source_unavailable"&&Number.isInteger(s.collection.attempts)&&s.collection.attempts>=1&&Number.isFinite(Date.parse(s.collection.checkedAt))&&Date.parse(s.collection.checkedAt)>=Date.parse(s.generatedAt)&&Date.parse(s.collection.checkedAt)<=Date.now()+300000,"融资补采状态无效");
}
export function marginSeries(rows:MarginRow[]):MarginPoint[]{
  let streak=0;
  return rows.map((row,i)=>{
    const balance=row.sh.balance+row.sz.balance,buy=row.sh.buy+row.sz.buy,repay=row.sh.repay+row.sz.repay;
    const net=buy-repay,sign=Math.sign(net);
    streak=sign===0?0:Math.sign(streak)===sign?streak+sign:sign;
    const sumNet=(n:number)=>i+1>=n?rows.slice(i-n+1,i+1).reduce((s,r)=>s+r.sh.buy+r.sz.buy-r.sh.repay-r.sz.repay,0):undefined;
    const recent=rows.slice(Math.max(0,i-19),i+1);
    const ratios=recent.map(r=>r.stockTurnover?(r.sh.buy+r.sz.buy)/r.stockTurnover*100:undefined);
    const baseline=i>=20?rows[i-20].sh.balance+rows[i-20].sz.balance:undefined;
    return {...row,balance,buy,repay,net,short:row.sh.short+row.sz.short,total:row.sh.total+row.sz.total,
      net5:sumNet(5),net20:sumNet(20),growth20:baseline!==undefined?(balance/baseline-1)*100:undefined,
      intensity:row.stockTurnover?buy/row.stockTurnover*100:undefined,
      intensity20:ratios.length===20&&ratios.every(x=>x!==undefined)?(ratios as number[]).reduce((a,b)=>a+b,0)/20:undefined,streak};
  });
}
export function quantile(values:number[],p:number){
  marginAssert(values.length>0&&p>=0&&p<=1,"分位计算输入无效");
  const sorted=[...values].sort((a,b)=>a-b),index=(sorted.length-1)*p,lo=Math.floor(index);
  return sorted[lo]+(sorted[Math.ceil(index)]-sorted[lo])*(index-lo);
}
export function marginLadder(points:MarginPoint[],index:number,key:LadderKey){
  const point=points[index];if(!point||point[key]===undefined)return null;
  const start=new Date(point.date);start.setUTCFullYear(start.getUTCFullYear()-3);
  // Exclude the selected session: a historical view must never see later data.
  const sample=points.slice(0,index).filter(p=>p.date>=start.toISOString().slice(0,10)&&p[key]!==undefined);
  if(sample.length<252)return null;
  const values=sample.map(p=>p[key] as number),bounds=[.2,.4,.6,.8].map(p=>quantile(values,p));
  if(bounds[0]===bounds[3])return null;
  const value=point[key] as number,band=bounds.filter(b=>value>=b).length;
  const rank=values.reduce((sum,x)=>sum+(x<value?1:x===value?0.5:0),0)/values.length*100;
  return {bounds,band,rank,count:sample.length,start:sample[0].date,end:sample.at(-1)!.date,value};
}
export const ladderLabels = {
  balance:["规模低位","规模偏低","规模中位","规模偏高","规模高位"],
  intensity20:["参与偏冷","参与偏低","参与中性","参与活跃","参与偏热"],
  growth20:["增速低位","增速偏低","增速中位","增速偏高","增速高位"],
};
