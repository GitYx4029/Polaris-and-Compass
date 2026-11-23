import assert from 'node:assert/strict';
import {setTimeout as pause} from 'node:timers/promises';

const origin=new URL(process.env.PAGES_URL??'https://gityx4029.github.io/Polaris-and-Compass/');
const expected=process.env.PAGES_EXPECTED_COMMIT;
assert.match(expected??'',/^[0-9a-f]{40}$/,'An exact published commit is required');
assert.equal(origin.hostname.toLowerCase(),'gityx4029.github.io','Unexpected Pages host');
assert.equal(origin.pathname,'/Polaris-and-Compass/','Unexpected Pages project path');
const attempts=Number(process.env.PAGES_VERIFY_ATTEMPTS??12);
assert(Number.isInteger(attempts)&&attempts>=1&&attempts<=12,'Invalid verification retry limit');

async function read(path){
  const url=new URL(path,origin);
  url.searchParams.set('release',expected);
  const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(12000)});
  assert(response.ok,`${url.pathname}: HTTP ${response.status}`);
  return response;
}

for(let attempt=1;attempt<=attempts;attempt++){
  try{
    const version=await (await read('build-info.json')).json();
    assert.equal(version.commit,expected,'Pages is still serving a different source version');
    const html=await (await read('./')).text();
    assert(html.includes('大A观测助手'),'Unexpected website title');
    const footer=html.match(/<section\b[^>]*id="quote-library"[^>]*>[\s\S]*?<\/section>/)?.[0];
    assert(footer?.includes('投资观点库下载'),'Updated quote library button is missing');
    assert.equal((footer.match(/<button\b/g)??[]).length,1,'Quote footer must contain one download button');
    assert(!footer.includes('逐条附有作者'),'Outdated quote library explanation is still visible');
    console.log(JSON.stringify({verified:true,url:origin.href,commit:expected,attempt}));
    break;
  }catch(error){
    if(attempt===attempts)throw error;
    console.warn(`Pages has not served the verified release yet (${attempt}/${attempts}): ${error.message}`);
    await pause(5000);
  }
}
