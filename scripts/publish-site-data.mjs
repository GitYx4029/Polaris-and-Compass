import {readFile} from 'node:fs/promises';
const origin='https://a-share-pulse-lxy-0924.reagan-park-6434.chatgpt.site';
const endpoint=`${origin}/api/publish-data`;
const allowed=new Set(['market-snapshot.json','etf-flows.json','etf-flows-history.json','margin.json']);
const names=process.argv.slice(2);
if(!names.length||names.some(name=>!allowed.has(name)))throw Error('Specify allowed public data files');
if(!process.env.ACTIONS_ID_TOKEN_REQUEST_URL||!process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)throw Error('This publisher must run in an authorized GitHub workflow');
const tokenUrl=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);tokenUrl.searchParams.set('audience',endpoint);
const identity=await fetch(tokenUrl,{headers:{Authorization:`Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`},signal:AbortSignal.timeout(15000)});
if(!identity.ok)throw Error(`GitHub identity HTTP ${identity.status}`);
const {value:token}=await identity.json();
if(typeof token!=='string')throw Error('GitHub did not return an identity token');
const files=Object.fromEntries(await Promise.all(names.map(async name=>[name,JSON.parse(await readFile(new URL(`../public/data/${name}`,import.meta.url),'utf8'))])));
for(let attempt=0;attempt<3;attempt++){
  const response=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({files}),signal:AbortSignal.timeout(25000)});
  if(!response.ok){if(response.status>=500&&attempt<2)continue;throw Error(`Site data publication HTTP ${response.status}: ${(await response.text()).slice(0,180)}`)}
  for(const name of names){
    const readback=await fetch(`${origin}/api/data/${name}?verify=${Date.now()}`,{signal:AbortSignal.timeout(15000)});
    if(!readback.ok||readback.headers.get('X-Data-Delivery')!=='persistent')throw Error(`Persistent readback failed: ${name}`);
    const data=await readback.json();
    const publishedDate=data.asOf??data.sessions?.at(-1)?.asOf;
    const expectedDate=files[name].asOf??files[name].sessions?.at(-1)?.asOf;
    if(!publishedDate||publishedDate<expectedDate)throw Error(`Readback date mismatch: ${name}`);
  }
  console.log(`Published and verified ${names.join(', ')}`);break;
}
