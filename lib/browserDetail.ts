// Browser-only emergency path when a scheduled GitHub snapshot has not arrived.
// It uses the same complete code ranges and date/coverage checks as the
// repository collector. Amounts are RMB 100 million (亿元).
export type QuoteBatch = { requested:string[]; quotes:Map<string,string> };
export type RecoveredDetail = {
  date:string;sh:number;sz:number;checkedAt:string;
  star?:number;starSource?:string;starCount?:number;starActive?:number;starCheckedAt?:string;
  etf?:number;etfSh?:number;etfSz?:number;etfCount?:number;etfActive?:number;
  etfSource?:string;etfCheckedAt?:string;
};

function fields(batch:QuoteBatch,symbol:string):string[]|null {
  const raw=batch.quotes.get(symbol);
  if(!raw)return null;
  const value=raw.split('~');
  if(value[2]!==symbol.slice(2))throw new Error(`报价代码不一致：${symbol}`);
  return value;
}
function amount(fields:string[],symbol:string):number {
  const value=Number(fields[57]); // Tencent: RMB 10,000.
  if(!Number.isFinite(value)||value<0)throw new Error(`成交额字段异常：${symbol}`);
  if(value>0){
    const raw=Number(String(fields[35]??'').split('/')[2]); // RMB yuan.
    if(!Number.isFinite(raw)||Math.abs(raw/1e4-value)>Math.max(1,value*.002))
      throw new Error(`成交额字段交叉核对失败：${symbol}`);
  }
  return value/1e4;
}
function quotedDate(fields:string[]):string|null {
  const stamp=String(fields[30]??'');
  return /^\d{14}$/.test(stamp)?`${stamp.slice(0,4)}-${stamp.slice(4,6)}-${stamp.slice(6,8)}`:null;
}

export function summarizeStar(batches:QuoteBatch[],date:string,shTotal:number){
  let total=0,active=0;const seen=new Set<string>();
  for(const batch of batches){
    if(!batch.quotes.get('sh688981'))throw new Error('科创板报价批次不完整');
    for(const symbol of batch.requested){
      const row=fields(batch,symbol);
      if(!row||!row[1]||row[61]==='ETF')continue;
      if(seen.has(symbol))throw new Error(`科创板报价重复：${symbol}`);
      seen.add(symbol);
      if(quotedDate(row)!==date)continue;
      const value=amount(row,symbol);
      if(value>0){total+=value;active++}
    }
  }
  if(seen.size<615||active<570||total<100||total>=shTotal*.9)
    throw new Error(`科创板覆盖或金额异常：${active}/${seen.size}`);
  return {star:total,starCount:seen.size,starActive:active,
    starSource:'腾讯财经科创板全代码段报价（浏览器补采）'};
}

export function summarizeEtf(batches:QuoteBatch[],date:string,etf300:number|null){
  let queried=0,count=0,active=0,sh=0,sz=0;const seen=new Set<string>();
  for(const batch of batches){
    if(!batch.quotes.get('sh510300'))throw new Error('ETF 报价批次不完整');
    queried+=batch.requested.length;
    for(const symbol of batch.requested){
      const row=fields(batch,symbol);
      if(!row||row[61]!=='ETF')continue;
      if(seen.has(symbol))throw new Error(`ETF 报价重复：${symbol}`);
      seen.add(symbol);count++;
      if(quotedDate(row)!==date)continue;
      const value=amount(row,symbol);
      if(value>0){if(symbol.startsWith('sh'))sh+=value;else sz+=value;active++}
    }
  }
  if(queried!==12000||count<500||active<300||sh<100||sz<100||
    (etf300!=null&&sh+sz<etf300))
    throw new Error(`ETF 覆盖或金额异常：${queried}/12000，${active}/${count}`);
  return {etf:sh+sz,etfSh:sh,etfSz:sz,etfCount:count,etfActive:active,
    etfSource:'腾讯财经全代码段报价（浏览器补采）'};
}

function groups(symbols:string[]):string[][]{
  const output:string[][]=[];
  for(let i=0;i<symbols.length;i+=80)output.push(symbols.slice(i,i+80));
  return output;
}
async function browserBatch(requested:string[],sentinel:string):Promise<QuoteBatch>{
  const symbols=[...new Set([...requested,sentinel])];
  const scope=window as unknown as Record<string,unknown>;
  const script=document.createElement('script');
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(error?:Error)=>{
      if(settled)return;settled=true;clearTimeout(timer);script.remove();
      const quotes=new Map<string,string>();
      for(const symbol of symbols){
        const value=scope[`v_${symbol}`];
        if(typeof value==='string')quotes.set(symbol,value);
        if(symbol!==sentinel)delete scope[`v_${symbol}`];
      }
      if(error||!quotes.get(sentinel))reject(error??new Error(`报价批次未返回校验代码 ${sentinel}`));
      else resolve({requested,quotes});
    };
    const timer=setTimeout(()=>finish(new Error('逐只报价请求超时')),10000);
    script.onload=()=>finish();
    script.onerror=()=>finish(new Error('逐只报价网络不可达'));
    script.src=`https://qt.gtimg.cn/q=${symbols.join(',')}`;
    script.async=true;document.head.appendChild(script);
  });
}
async function collect(symbols:string[],sentinel:string,workers:number){
  const sets=groups(symbols),result:QuoteBatch[]=Array(sets.length);let cursor=0;
  async function worker(){while(cursor<sets.length){
    const index=cursor++;
    try{result[index]=await browserBatch(sets[index],sentinel)}
    catch{result[index]=await browserBatch(sets[index],sentinel)}
  }}
  await Promise.all(Array.from({length:workers},worker));
  return result;
}
export async function recoverBrowserDetail(date:string,sh:number,sz:number,
  etf300:number|null,needStar:boolean,needEtf:boolean):Promise<RecoveredDetail>{
  const checkedAt=new Date().toISOString();
  const recovered:RecoveredDetail={date,sh,sz,checkedAt};
  const tasks:Promise<void>[]=[];
  if(needStar){
    const symbols:string[]=[];
    for(const prefix of ['688','689'])for(let i=0;i<1000;i++)
      symbols.push(`sh${prefix}${String(i).padStart(3,'0')}`);
    tasks.push(collect(symbols,'sh688981',4).then(batches=>{
      Object.assign(recovered,summarizeStar(batches,date,sh),{starCheckedAt:checkedAt});
    }));
  }
  if(needEtf){
    const symbols:string[]=[];
    for(let code=500000;code<600000;code+=10)symbols.push(`sh${code}`);
    for(let code=158000;code<160000;code++)symbols.push(`sz${code}`);
    tasks.push(collect(symbols,'sh510300',8).then(batches=>{
      Object.assign(recovered,summarizeEtf(batches,date,etf300),{etfCheckedAt:checkedAt});
    }));
  }
  const settled=await Promise.allSettled(tasks);
  if(!recovered.star&&!recovered.etf)
    throw new Error(settled.filter(x=>x.status==='rejected').map(x=>String(x.reason)).join('；')||'细分项未能核验');
  return recovered;
}
