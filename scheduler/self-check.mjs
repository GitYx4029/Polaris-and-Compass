import assert from 'node:assert/strict';
import {runWatchdog,snapshotComplete} from './worker.mjs';

const at=Date.parse('2026-09-29T08:41:00Z'); // Beijing 16:41, Tuesday.
const row={date:'2026-09-29',sh:6617,sz:7475,star:2066.76,
  starSource:'上海证券交易所分类成交',etf:4570.24,etfSh:3431.84,
  etfSz:1138.4,etfCount:1859,etfSource:'腾讯财经全代码段报价'};
const valid={asOf:row.date,generatedAt:'2026-09-29T08:00:00Z',
  quoteAt:['2026-09-29 15:35','2026-09-29 15:35'],history:[row]};
assert.equal(snapshotComplete(valid,at),true);
assert.equal(snapshotComplete({...valid,history:[{...row,star:null}]},at),false);
assert.equal(snapshotComplete({...valid,history:[{...row,etfSz:1100}]},at),false);
assert.equal(snapshotComplete({...valid,quoteAt:['2026-09-28 16:14','2026-09-29 15:35']},at),false);
assert.equal(snapshotComplete({...valid,generatedAt:'2026-09-29T04:30:00Z'},at),false);
assert.equal(snapshotComplete({...valid,generatedAt:'2026-09-29T04:30:00Z'},
  Date.parse('2026-09-29T04:41:00Z')),true);
assert.equal(snapshotComplete(valid,Date.parse('2026-09-29T04:41:00Z')),false);

let dispatches=0;
const fetcher=async (url,options)=>{
  if(options?.method==='POST'){
    assert.equal(options.headers.Authorization,'Bearer test-secret');
    assert.equal(JSON.parse(options.body).ref,'main');
    dispatches++;
    return {status:204};
  }
  assert.match(url,/market-snapshot\.json\?check=/);
  return {ok:true,json:async()=>valid};
};
assert.equal((await runWatchdog(at,'test-secret',fetcher)).state,'verified');
assert.equal(dispatches,0);
assert.equal((await runWatchdog(at,'test-secret',async (url,options)=>
  options?.method==='POST'?fetcher(url,options):{ok:true,json:async()=>({...valid,history:[{...row,star:null}]})}
)).state,'dispatched');
assert.equal(dispatches,1);
assert.equal((await runWatchdog(Date.parse('2026-10-03T08:41:00Z'),'test-secret',fetcher)).state,'weekend');
assert.equal(dispatches,1);
await assert.rejects(runWatchdog(at,'test-secret',async()=>({status:401,text:async()=>'unauthorized'})),
  /workflow dispatch HTTP 401/);
console.log('scheduler self-check: verified close, missing STAR, misaligned ETF, stale date, noon, weekend and dispatch');
