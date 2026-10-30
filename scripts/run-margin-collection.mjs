import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {collectMargin} from './collect-margin.mjs';
import {SourceUnavailable} from './margin-resilience.mjs';
import {validateMargin} from '../lib/margin.ts';

export async function runMarginCollection({directory=path.resolve(process.env.MARGIN_OUTPUT_DIR??'public/data'),collect=collectMargin,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),attempts=2,now=()=>new Date(),summary=process.env.GITHUB_STEP_SUMMARY}={}){
  let failure;
  for(let attempt=1;attempt<=attempts;attempt++){
    try{return await collect({directory});}
    catch(error){
      // Contradictory amounts, units, dates and broken balance identities are
      // validation failures. Never retry them into success or hide them.
      if(!(error instanceof SourceUnavailable))throw error;
      failure=error;
      console.warn(`Financing source unavailable (attempt ${attempt}/${attempts}): ${error.message}`);
      if(attempt<attempts)await wait(15000);
    }
  }
  const file=path.join(directory,'margin.json');
  let prior;try{prior=JSON.parse(await fs.readFile(file,'utf8'));validateMargin(prior);}catch{throw failure;}
  // Preserve statistical date, verified timestamp and every number. Only the
  // operational status changes, making the outstanding collection visible.
  prior.collection={state:'pending',checkedAt:now().toISOString(),attempts,reason:'source_unavailable'};
  validateMargin(prior);
  await fs.writeFile(file+'.tmp',JSON.stringify(prior)+'\n');await fs.rename(file+'.tmp',file);
  const message=`Financing collection pending after ${attempts} attempts. Last verified session: ${prior.asOf}. Verified figures preserved; next scheduled run will retry.`;
  console.warn(`::warning::${message}`);
  if(summary)await fs.appendFile(summary,`\n### Financing collection pending\n${message}\n`);
  return {asOf:prior.asOf,pending:true,attempts};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{console.log(JSON.stringify(await runMarginCollection()));}catch(error){console.error(error);process.exitCode=1;}
}
