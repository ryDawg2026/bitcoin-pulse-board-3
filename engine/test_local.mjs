// Local harness: runs the real worker bundle against an in-memory fake of the D1 calls it uses, with REAL network feeds. Reports CPU time per run.
import fs from 'fs';
const src=fs.readFileSync(new URL('./dist/worker.js',import.meta.url),'utf8');fs.writeFileSync(new URL('./dist/worker.mjs',import.meta.url),src);
const worker=(await import('./dist/worker.mjs')).default;
const T=new Map();let writes=0,reads=0;
function stmt(sql){let args=[];const o={bind(...a){args=a;return o},
  exec(){sql=sql.trim();let m;
    if(/^SELECT k,v FROM kv WHERE k=\?/.test(sql)){reads++;const r=T.get(args[0]);return {results:r?[{k:args[0],v:r.v}]:[],meta:{}}}
    if(/^INSERT INTO kv\(k,v,t\) VALUES\(\?,\?,\?\) ON CONFLICT/.test(sql)){writes++;T.set(args[0],{v:args[1],t:args[2]});return {results:[],meta:{changes:1}}}
    if(/^INSERT OR IGNORE INTO kv/.test(sql)){if(!T.has('lock'))T.set('lock',{v:'0',t:0});return {results:[],meta:{changes:0}}}
    if(/^UPDATE kv SET v=\?,t=\? WHERE k='lock' AND CAST/.test(sql)){const l=T.get('lock');if(parseInt(l.v)<args[2]){T.set('lock',{v:args[0],t:args[1]});return {results:[],meta:{changes:1}}}return {results:[],meta:{changes:0}}}
    if(/^UPDATE kv SET v='0'/.test(sql)){T.set('lock',{v:'0',t:args[0]});return {results:[],meta:{changes:1}}}
    throw new Error('unhandled sql '+sql)},
  async first(){const r=o.exec();return r.results[0]||null},async run(){return o.exec()},async all(){return o.exec()}};return o}
const env={DB:{prepare:stmt,async batch(a){return a.map(x=>x.exec())}}};
const N=+process.argv[2]||2;
if(process.env.SCORE){await worker._run(env);
  const W=Math.floor(Date.now()/900000)*900-1800,rounds=JSON.parse(T.get('callers.rounds').v);
  rounds[W]={W:W,calls:{dash:[{i:0,at:W+63,dir:'UP',conf:70,p:.7,px:70000,secs:60,src:'x',gate:{lvl:'ok'},backs:0,shadow:false}],zippy:[null,null,null],mellow:[null,null,null],ripple:[null,null,null],sage:[null,null,null],flippy:[null],chief:[null]},res:null,scored:false};
  T.set('callers.rounds',{v:JSON.stringify(rounds),t:0});
  const rf=globalThis.fetch;globalThis.fetch=async(u,o)=>{u=String(u);if(/status=settled/.test(u))return new Response(JSON.stringify({markets:[{result:'yes',close_time:new Date((W+900)*1000).toISOString()}]}),{status:200});return rf(u,o)};
  const r=await worker._run(env);const core=JSON.parse(T.get('callers.core').v),bd=JSON.parse(T.get('badges').v);const h=JSON.parse(T.get('health').v);
  console.log('scored run',JSON.stringify(r),'dash tot',JSON.stringify(core.tot.dash.a),'badge dash',JSON.stringify(bd.st.dash.n),'nSettled',h.last.nSettled,'err',h.lastError);
  const r2=await worker._run(env);console.log('idempotent rerun dash tot',JSON.stringify(JSON.parse(T.get('callers.core').v).tot.dash.a));
  // lease: held lock blocks an overlapping run
  T.set('lock',{v:String(Math.floor(Date.now()/1000)+50),t:0});const r3=await worker._run(env);console.log('overlap run',JSON.stringify(r3),'skipped',JSON.parse(T.get('health').v).skippedOverlap);process.exit()}
if(process.env.PROF){const cache=new Map();const rf=globalThis.fetch;globalThis.fetch=async(u,o)=>{u=String(u);if(!cache.has(u)){const r=await rf(u,o);cache.set(u,{s:r.status,b:await r.text()})}const c=cache.get(u);return new Response(c.b,{status:c.s})};
for(let i=0;i<+(process.env.PN||12);i++){const c0=process.cpuUsage();await worker._run(env);const c=process.cpuUsage(c0);console.log('prof run',i,((c.user+c.system)/1000).toFixed(1),'ms');}process.exit()}
for(let i=0;i<N;i++){const c0=process.cpuUsage(),t0=Date.now();const r=await worker._run(env);const c=process.cpuUsage(c0);
  const h=JSON.parse(T.get('health')?.v||'null');console.log('run',i,JSON.stringify(r),'wall ms',Date.now()-t0,'cpu ms',((c.user+c.system)/1000).toFixed(1),'rows',[...T.keys()].map(k=>k+':'+(T.get(k).v.length)).join(' '));
  console.log('  last',JSON.stringify(h&&h.last),'err',h&&h.lastError);
  if(i<N-1)await new Promise(r=>setTimeout(r,Math.max(0,61000-(Date.now()-t0))));}
console.log('db reads',reads,'writes',writes);
