// Independently sum STAR stock turnover from Tencent and Eastmoney quotes.
// All amounts returned here are RMB 100 million (亿元). Never treat missing
// quotes as zero or a stale quote as a current-session trade.
const dateOf=stamp=>Number.isFinite(Number(stamp))&&Number(stamp)>0
  ?new Date(Number(stamp)*1000).toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'}):null;
const codeOf=code=>/^68[89]\d{3}$/.test(String(code??''));

export function parseEastmoneyStar(body, date, shTotal) {
  const result=typeof body==='string'?JSON.parse(body):body;
  const data=result?.data;
  const rows=Array.isArray(data?.diff)?data.diff:Object.values(data?.diff??{});
  // 618 STAR securities were independently reported at the 2026-09-24 close.
  // Allow three listing changes, but reject a partially returned universe.
  if(!Number.isInteger(data?.total)||data.total<615||data.total>1000||rows.length!==data.total)
    throw new Error(`Eastmoney STAR coverage ${rows.length}/${data?.total}`);
  let amount=0, active=0;
  const codes=new Set();
  for(const row of rows){
    const code=String(row.f12??'');
    if(!codeOf(code)||Number(row.f13)!==1||codes.has(code))throw new Error(`Eastmoney STAR invalid code ${code}`);
    codes.add(code);
    const quoted=Number(row.f6), stamp=Number(row.f124);
    if(dateOf(stamp)!==date)continue; // Suspended stocks retain an old quote.
    if(!Number.isFinite(quoted)||quoted<0)throw new Error(`Eastmoney STAR amount ${code}`);
    if(quoted>0){amount+=quoted/1e8;active++}
  }
  if(active<570||amount<100||amount>=shTotal*.9)throw new Error(`Eastmoney STAR totals ${active}/${codes.size}: ${amount}`);
  return {amount,active,count:codes.size,source:'东方财富科创板逐股报价'};
}

export function parseTencentStarBatches(batches, date, shTotal){
  const seen=new Set();let amount=0,active=0;
  for(const [request,raw] of batches){
    const quotes=[...raw.matchAll(/v_sh(\d{6})="([^"]*)";/g)];
    if(!quotes.some(match=>match[1]==='688981'))throw new Error('Tencent STAR batch truncated');
    for(const match of quotes){
      const code=match[1];
      if(code==='688981'&&!request.includes(code))continue; // Batch sentinel.
      if(!request.includes(code)||seen.has(code))throw new Error(`Tencent STAR duplicate ${code}`);
      const fields=match[2].split('~');
      if(fields[2]!==code||!fields[1]||fields[61]==='ETF')continue;
      seen.add(code);
      const quoted=Number(fields[57]);
      const stamp=String(fields[30]??'');
      if(!/^\d{14}$/.test(stamp))continue;
      const day=`${stamp.slice(0,4)}-${stamp.slice(4,6)}-${stamp.slice(6,8)}`;
      if(day!==date)continue;
      if(!Number.isFinite(quoted)||quoted<0)throw new Error(`Tencent STAR malformed quote ${code}`);
      if(quoted>0){
        const yuan=Number(String(fields[35]??'').split('/')[2]);
        if(!Number.isFinite(yuan)||Math.abs(yuan/1e4-quoted)>Math.max(1,quoted*.002))
          throw new Error(`Tencent STAR raw/precise amount mismatch ${code}`);
        amount+=quoted/1e4;active++; // f57 is RMB 10,000; f35 is RMB.
      }
    }
  }
  if(seen.size<615||active<570||amount<100||amount>=shTotal*.9)
    throw new Error(`Tencent STAR coverage ${active}/${seen.size}: ${amount}`);
  return {amount,active,count:seen.size,source:'腾讯财经科创板全代码段报价'};
}

export async function starFallback(date,shTotal,get){
  const eastmoney=async()=>{
    const url=new URL('https://82.push2.eastmoney.com/api/qt/clist/get');
    for(const [key,value] of Object.entries({pn:'1',pz:'1000',po:'1',np:'1',fltt:'2',invt:'2',fid:'f6',fs:'m:1+t:23',fields:'f12,f13,f14,f6,f124'}))url.searchParams.set(key,value);
    return parseEastmoneyStar(await get(url),date,shTotal);
  };
  const tencent=async()=>{
    const symbols=[];
    for(const prefix of ['688','689'])for(let i=0;i<1000;i++)symbols.push(prefix+String(i).padStart(3,'0'));
    const groups=[];for(let i=0;i<symbols.length;i+=80)groups.push(symbols.slice(i,i+80));
    const batches=Array(groups.length);let next=0;
    async function worker(){while(next<groups.length){
      const index=next++,group=groups[index];
      const url=new URL('https://qt.gtimg.cn/');
      url.searchParams.set('q',[...group.filter(code=>code!=='688981'),'sh688981'].map(code=>code.startsWith('sh')?code:`sh${code}`).join(','));
      batches[index]=[group,await get(url)];
    }}
    await Promise.all(Array.from({length:6},()=>worker()));
    return parseTencentStarBatches(batches,date,shTotal);
  };
  const [em,qq]=await Promise.allSettled([eastmoney(),tencent()]);
  if(qq.status==='rejected'&&em.status==='rejected')
    throw new Error(`STAR fallback unavailable: ${em.reason}; ${qq.reason}`);
  if(em.status==='fulfilled'&&qq.status==='fulfilled'){
    const a=em.value,b=qq.value;
    if(Math.abs(a.amount-b.amount)>Math.max(3,a.amount*.0075)||Math.abs(a.count-b.count)>5)
      throw new Error(`STAR sources disagree: Eastmoney ${a.amount.toFixed(2)}/${a.count}, Tencent ${b.amount.toFixed(2)}/${b.count}`);
    return {...a,source:'东方财富／腾讯财经逐股交叉核验'};
  }
  return em.status==='fulfilled'?em.value:qq.value;
}
