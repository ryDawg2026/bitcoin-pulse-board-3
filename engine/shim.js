/* pulse3-engine: tiny browser shim so the SAME site modules (indicators.js, news.js, badges.js, callers.js) run unchanged inside a Cloudflare Worker.
   No DOM exists here: callers.js sees no #callersBody and so only does its data work (fire calls, score, learn, badges), never rendering. */
globalThis.window=globalThis;
(function(){var mem={};globalThis.localStorage={getItem:function(k){return Object.prototype.hasOwnProperty.call(mem,k)?mem[k]:null},setItem:function(k,v){mem[k]=String(v)},removeItem:function(k){delete mem[k]},_mem:mem}})();
globalThis.document={getElementById:function(){return null},querySelectorAll:function(){return []},querySelector:function(){return null},addEventListener:function(){},readyState:'complete'};
if(typeof globalThis.dispatchEvent!=='function')globalThis.dispatchEvent=function(){return true};
if(typeof globalThis.addEventListener!=='function')globalThis.addEventListener=function(){};
/* Intl is slow to initialise in a fresh isolate (tens of ms of CPU on the free plan). The only locale call on the server path is usd() → en-US grouping with fixed decimals, so do it by hand. */
(function(){var o=Number.prototype.toLocaleString;Number.prototype.toLocaleString=function(loc,opt){
  if(opt&&typeof opt.minimumFractionDigits==='number'&&opt.minimumFractionDigits===opt.maximumFractionDigits&&(loc==='en-US')){var s=this.toFixed(opt.minimumFractionDigits),p=s.split('.');p[0]=p[0].replace(/\B(?=(\d{3})+(?!\d))/g,',');return p.join('.')}
  return o.apply(this,arguments)}})();
