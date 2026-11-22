import fs from 'node:fs/promises';
import {validateBasket,basketSeries,basketSum} from '../lib/etfBasket.ts';
const x=JSON.parse(await fs.readFile(process.argv[2]??'public/data/etf-basket.json','utf8'));validateBasket(x);
const points=basketSeries(x),latest=points.at(-1);
console.log(JSON.stringify({basketVerified:true,asOf:x.asOf,coverage:`${latest.valid}/${latest.expected}`,sessions:points.length,latestNetYi:latest.net/1e8,net20Yi:basketSum(points,20)===null?null:basketSum(points,20)/1e8}));
