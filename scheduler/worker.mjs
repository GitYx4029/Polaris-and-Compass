// Independent clock for the existing, deterministic GitHub collector.
// 204 from workflow_dispatch means accepted, not completed: subsequent ticks
// recheck the committed snapshot and retry until its closed session is valid.
const owner='GitYx4029';
const repository='Polaris-and-Compass';
const workflow='collect-market.yml';
const snapshotUrl=`https://raw.githubusercontent.com/${owner}/${repository}/main/public/data/market-snapshot.json`;
const dispatchUrl=`https://api.github.com/repos/${owner}/${repository}/actions/workflows/${workflow}/dispatches`;

function beijing(at){
  // China has no daylight saving time. Shift before using UTC accessors.
  const date=new Date(at+8*60*60*1000);
  return {day:date.toISOString().slice(0,10),clock:date.toISOString().slice(11,16),
    weekday:date.getUTCDay()};
}

export function snapshotComplete(snapshot,at){
  const {day,clock}=beijing(at);
  if(!snapshot||snapshot.asOf!==day||!Array.isArray(snapshot.history))return false;
  const latest=snapshot.history.at(-1);
  if(latest?.date!==day)return false;
  const generated=Date.parse(snapshot.generatedAt);
  if(!Number.isFinite(generated)||generated>at+5*60*1000)return false;
  const generatedInBeijing=beijing(generated);
  if(generatedInBeijing.day!==day)return false;
  if(clock<'15:25')return generatedInBeijing.clock>='12:00';
  return generatedInBeijing.clock>='15:25'&&
    latest.sh>0&&latest.sz>0&&latest.star>0&&
    latest.starSource==='上海证券交易所分类成交'&&
    latest.etf>0&&latest.etfSh>0&&latest.etfSz>0&&latest.etfCount>500&&
    latest.etfSource==='腾讯财经全代码段报价'&&
    Math.abs(latest.etf-latest.etfSh-latest.etfSz)<.02&&
    Array.isArray(snapshot.quoteAt)&&snapshot.quoteAt.length===2&&
    snapshot.quoteAt.every(stamp=>typeof stamp==='string'&&
      stamp.startsWith(`${day} `)&&stamp.slice(11)>='15:15');
}

export async function runWatchdog(at,token,fetcher=fetch){
  const {day,weekday}=beijing(at);
  if(weekday===0||weekday===6)return {state:'weekend',day};
  if(!token)throw new Error('Missing GITHUB_ACTIONS_TOKEN');

  let complete=false;
  let snapshotError=null;
  try{
    const response=await fetcher(`${snapshotUrl}?check=${at}`,{
      headers:{'Accept':'application/json'},cache:'no-store'});
    if(!response.ok)throw new Error(`snapshot HTTP ${response.status}`);
    complete=snapshotComplete(await response.json(),at);
  }catch(error){
    // A stale/unavailable snapshot is exactly when the independent trigger is useful.
    snapshotError=String(error);
  }
  if(complete)return {state:'verified',day};

  const response=await fetcher(dispatchUrl,{
    method:'POST',
    headers:{
      'Accept':'application/vnd.github+json',
      'Authorization':`Bearer ${token}`,
      'Content-Type':'application/json',
      'User-Agent':'polaris-market-watchdog',
      'X-GitHub-Api-Version':'2022-11-28'
    },
    body:JSON.stringify({ref:'main'})
  });
  if(response.status!==204)
    throw new Error(`workflow dispatch HTTP ${response.status}: ${(await response.text()).slice(0,200)}`);
  return {state:'dispatched',day,snapshotError};
}

export default {
  async scheduled(event,env){
    const outcome=await runWatchdog(event.scheduledTime,env.GITHUB_ACTIONS_TOKEN);
    console.log(JSON.stringify(outcome));
  }
};
