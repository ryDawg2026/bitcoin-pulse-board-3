// Local check of /calls: one real run (real feeds, fake D1), then GET /calls.
import fs from 'fs';
fs.writeFileSync(new URL('./dist/worker.mjs',import.meta.url),fs.readFileSync(new URL('./dist/worker.js',import.meta.url),'utf8'));
const worker=(await import('./dist/worker.mjs')).default;
const T=new Map();
function stmt(sql){let args=[];const o={bind(...a){args=a;return o},exec(){sql=sql.trim();
  if(/^SELECT k,v FROM kv WHERE k=\?/.test(sql)){const r=T.get(args[0]);return {results:r?[{k:args[0],v:r.v}]:[],meta:{}}}
  if(/^INSERT INTO kv\(k,v,t\)/.test(sql)){T.set(args[0],{v:args[1],t:args[2]});return {results:[],meta:{changes:1}}}
  if(/^INSERT OR IGNORE/.test(sql)){if(!T.has('lock'))T.set('lock',{v:'0',t:0});return {results:[],meta:{changes:0}}}
  if(/^UPDATE kv SET v=\?,t=\? WHERE k='lock'/.test(sql)){const l=T.get('lock');if(parseInt(l.v)<args[2]){T.set('lock',{v:args[0],t:args[1]});return {results:[],meta:{changes:1}}}return {results:[],meta:{changes:0}}}
  if(/^UPDATE kv SET v='0'/.test(sql)){T.set('lock',{v:'0',t:args[0]});return {results:[],meta:{changes:1}}}
  throw new Error(sql)},async run(){return o.exec()},async all(){return o.exec()}};return o}
const env={DB:{prepare:stmt,async batch(a){return a.map(x=>x.exec())}}};
globalThis.caches={default:{match:async()=>null,put:async()=>{}}};
if(process.env.SEED){const r=JSON.parse(fs.readFileSync(process.env.SEED,'utf8'));T.set('callers.core',{v:JSON.stringify(r.core),t:0});T.set('callers.rounds',{v:JSON.stringify(r.rounds),t:0})}
await worker._run(env);
const res=await worker.fetch(new Request('https://x/calls'),env,{waitUntil(){}});
console.log(res.status, JSON.stringify(await res.json(),null,1).slice(0,4000));process.exit();
