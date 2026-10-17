import fs from 'node:fs/promises';
import {validateMargin,marginSeries,marginLadder,marginAssert as check} from '../lib/margin.ts';
const snapshot=JSON.parse(await fs.readFile(process.env.MARGIN_FILE??'public/data/margin.json','utf8'));
validateMargin(snapshot);const points=marginSeries(snapshot.history),last=points.at(-1);
check(last.intensity20!==undefined&&last.net20!==undefined&&last.growth20!==undefined,'latest financing derived values missing');
for(const key of ['balance','intensity20','growth20'])check(marginLadder(points,points.length-1,key),'insufficient calibration history');
console.log(JSON.stringify({asOf:snapshot.asOf,sessions:points.length,balanceYi:last.balance/1e8,netYi:last.net/1e8,
  ladders:Object.fromEntries(['balance','intensity20','growth20'].map(key=>[key,marginLadder(points,points.length-1,key)]))}));
