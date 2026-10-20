import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { chrome } from './browser.mjs';
import { locateSlider } from './captcha.mjs';
const browser=await chromium.launch({executablePath:chrome,headless:true});
try {
  const page=await browser.newPage();
  const g=JSON.parse(await readFile('artifacts/captcha-geometry.json','utf8'));
  await page.setContent('<div id="slideBg"></div><div class="tc-fg-item"></div>');
  await page.evaluate(g=>{for(const [key,selector] of [['bg','#slideBg'],['piece','.tc-fg-item']]) {const e=document.querySelector(selector),s=g[key];Object.assign(e.style,{position:'absolute',width:s.width+'px',height:s.height+'px',left:s.left+'px',top:s.top+'px',backgroundImage:`url("${s.url}")`,backgroundSize:s.size,backgroundPosition:s.position,cursor:key==='piece'?'pointer':'default'});}},g);
  const mock={request:{get:async url=>{const i=url===g.bg.url?0:1;const body=await readFile(`artifacts/captcha-asset-${i}.png`);return{ok:()=>true,headers:()=>({'content-type':'image/png'}),body:async()=>body};}}};
  console.log(await locateSlider(mock,page));
} finally {await browser.close();}
