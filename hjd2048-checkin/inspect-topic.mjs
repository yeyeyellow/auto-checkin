import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chrome, forumUrl, contextOptions, dismissNotice } from './browser.mjs';
const root = fileURLToPath(new URL('.', import.meta.url));
const browser = await chromium.launch({ executablePath: chrome, headless: true });
try {
  const page = await browser.newPage(await contextOptions(browser, root));
  await page.route('**/*', r => ['image','media'].includes(r.request().resourceType()) ? r.abort() : r.continue());
  await page.goto(process.argv[2] || forumUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await dismissNotice(page);
  await writeFile(`${root}artifacts/topic-page.html`, await page.content());
  console.log(JSON.stringify(await page.evaluate(() => ({ url: location.href, links: [...document.querySelectorAll('a')].map(e=>({text:e.innerText.trim(),href:e.getAttribute('href')})).filter(e=>/回复|发表时间/.test(e.text)).slice(0,10), topics: [...document.querySelectorAll('a[id^="a_ajax_"]')].map(e=>({tid:e.id.replace('a_ajax_',''),date:e.closest('tr')?.querySelector('.gray')?.innerText,href:e.getAttribute('href')})).sort((a,b)=>Number(b.tid)-Number(a.tid)).slice(0,3), forms: [...document.forms].map(f=>({name:f.name,action:f.getAttribute('action'),fields:[...f.querySelectorAll('input,textarea,button')].map(e=>({tag:e.tagName,name:e.name,id:e.id,type:e.type,text:e.innerText?.slice(0,60)}))})) })), null, 2));
} finally { await browser.close(); }
