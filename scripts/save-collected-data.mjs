// Separate collectors update separate files. Rebase/retry only their own commit
// when another collector wins a push race. A content conflict still fails.
import {execFileSync} from 'node:child_process';
const allowed=new Set(['public/data/market-snapshot.json','public/data/etf-flows.json','public/data/etf-flows-history.json','public/data/margin.json']);
const files=process.argv.slice(2);
if(!files.length||files.some(f=>!allowed.has(f)))throw Error('Only collected public data files may be committed');
const git=(...args)=>execFileSync('git',args,{stdio:['ignore','pipe','pipe'],encoding:'utf8'});
git('add','--',...files);
let changed=true;try{git('diff','--cached','--quiet');changed=false;}catch(error){if(error.status!==1)throw error;}
if(changed){
  git('config','user.name','github-actions[bot]');git('config','user.email','41898282+github-actions[bot]@users.noreply.github.com');
  git('commit','-m',`Update verified ${files.map(f=>f.split('/').at(-1)).join(', ')}`);
  for(let attempt=1;;attempt++){
    git('pull','--rebase','origin','main');
    try{git('push','origin','HEAD:main');break;}
    catch(error){if(attempt>=4)throw error;await new Promise(resolve=>setTimeout(resolve,attempt*2000));}
  }
}
if(process.env.GITHUB_OUTPUT){const {appendFileSync}=await import('node:fs');appendFileSync(process.env.GITHUB_OUTPUT,`changed=${changed}\n`);}
console.log(JSON.stringify({changed,files}));
