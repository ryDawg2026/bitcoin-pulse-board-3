// Build-time: render each caller's avatar SVG with callers.js's own avatar() so the page needs no JS libraries.
import fs from 'fs';
const src=fs.readFileSync(new URL('./shim.js',import.meta.url),'utf8')+'\n'+fs.readFileSync(new URL('../callers.js',import.meta.url),'utf8');
(0,eval)(src);
const o={};for(const id of globalThis.CallersPanel.IDS)o[id]=globalThis.CallersPanel.avatar(id,'p3');
fs.writeFileSync(new URL('./avatars.json',import.meta.url),JSON.stringify(o));console.log(Object.keys(o).join(','),JSON.stringify(o).length);
