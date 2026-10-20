export async function locateSlider(page, frame, root, { artifactDir = root ? `${root}artifacts/` : null } = {}) {
  await frame.waitForFunction(() => document.querySelector('#slideBg') && [...document.querySelectorAll('.tc-fg-item')].some(e => !e.classList.contains('tc-slider-normal') && parseFloat(e.style.width) < 120 && getComputedStyle(e).backgroundImage !== 'none' && getComputedStyle(e).cursor === 'pointer'), null, {timeout:15000});
  const geometry = await frame.evaluate(() => {
    const bg = document.querySelector('#slideBg');
    const piece = [...document.querySelectorAll('.tc-fg-item')].find(e => !e.classList.contains('tc-slider-normal') && parseFloat(e.style.width) < 120 && getComputedStyle(e).backgroundImage !== 'none' && getComputedStyle(e).cursor === 'pointer');
    if (!bg || !piece) return null;
    const extract = e => { const s = getComputedStyle(e); return { width: parseFloat(s.width), height: parseFloat(s.height), left: parseFloat(s.left), top: parseFloat(s.top), url: s.backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1], size: s.backgroundSize, position: s.backgroundPosition }; };
    return { bg: extract(bg), piece: extract(piece) };
  });
  if (!geometry?.bg.url || !geometry?.piece.url) throw new Error('验证码不是已识别的腾讯图片滑块');
  const images = [];
  for (const item of [geometry.bg, geometry.piece]) {
    const url = new URL(item.url);
    if (!/(^|\.)(captcha\.qcloud\.com|captcha\.gtimg\.com)$/.test(url.host)) throw new Error('验证码图片来源无法确认');
    const response = await page.request.get(item.url);
    if (!response.ok()) throw new Error('验证码图片加载失败');
    images.push(`data:${response.headers()['content-type']};base64,${(await response.body()).toString('base64')}`);
  }
  if(artifactDir) {
    await writeFile(`${artifactDir}captcha-geometry.json`,JSON.stringify(geometry,null,2));
    for(const [i,src] of images.entries()) await writeFile(`${artifactDir}captcha-asset-${i}.png`,Buffer.from(src.split(',')[1],'base64'));
  }
  const estimate = await frame.evaluate(async ({ geometry, images }) => {
    const [bg, fg] = await Promise.all(images.map(async src => { const img = new Image(); img.src = src; await img.decode(); return img; }));
    const make = (w,h) => { const c = document.createElement('canvas'); c.width=Math.round(w); c.height=Math.round(h); return c; };
    const displayScale=geometry.bg.width/bg.width;
    const background = make(bg.width, bg.height);
    const bctx = background.getContext('2d');
    bctx.drawImage(bg, 0, 0);
    const [sw,sh] = geometry.piece.size.split(' ').map(parseFloat);
    const [px,py] = geometry.piece.position.split(' ').map(parseFloat);
    if (![sw,sh,px,py].every(Number.isFinite)) return null;
    const scale=sw/fg.width;
    const template = make(geometry.piece.width/scale, geometry.piece.height/scale);
    const tctx = template.getContext('2d');
    // 在素材原始分辨率找轮廓，避免缩小图片后描边断裂。
    tctx.drawImage(fg, px/scale, py/scale, sw/scale, sh/scale);
    const td = tctx.getImageData(0,0,template.width,template.height).data;
    const bd = bctx.getImageData(0,0,background.width,background.height).data;
    // 腾讯拼图素材可能是完整的方形图片，alpha 不能作为拼图形状。
    // 找白色轮廓的连通区域，再在背景同一高度匹配轮廓亮度边缘。
    const detect = threshold => {
    const whites = new Set();
    for(let y=2;y<template.height-2;y++) for(let x=2;x<template.width-2;x++) {
      const i=(y*template.width+x)*4;
      const min=Math.min(td[i],td[i+1],td[i+2]),max=Math.max(td[i],td[i+1],td[i+2]);
      if(td[i+3]>180&&min>threshold&&max-min<35) whites.add(y*template.width+x);
    }
    const components=[],componentStats=[];
    while(whites.size) {
      const seed=whites.values().next().value; whites.delete(seed);
      const queue=[seed],points=[];
      for(let k=0;k<queue.length;k++) {
        const p=queue[k],x=p%template.width,y=Math.floor(p/template.width);points.push({x,y});
        for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
          if(x+dx<0||x+dx>=template.width) continue;
          const next=(y+dy)*template.width+x+dx;
          if(whites.delete(next)) queue.push(next);
        }
      }
      const width=Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x))+1;
      const height=Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y))+1;
      componentStats.push({points:points.length,width,height});
      if(points.length>=30&&width>template.width*0.5&&height>template.height*0.5&&points.length<width*height*0.4) components.push(points);
    }
    const boundary=components.sort((a,b)=>b.length-a.length)[0]?.map(p=>({x:p.x*scale/displayScale,y:p.y*scale/displayScale}));
    if(!boundary) return {error:'轮廓未完整识别',components:componentStats.sort((a,b)=>b.points-a.points).slice(0,5)};
    const top = Math.round(geometry.piece.top/displayScale);
    const gray = (x,y) => { const i=(Math.round(y)*background.width+Math.round(x))*4; return (bd[i]+bd[i+1]+bd[i+2])/3; };
    const scores = [];
    for(let left=Math.ceil((geometry.piece.left+geometry.piece.width)/displayScale);left<background.width-geometry.piece.width/displayScale-3;left++) {
      let edge=0;
      for(const p of boundary) edge += gray(left+p.x,top+p.y)-(gray(left+p.x-3,top+p.y)+gray(left+p.x+3,top+p.y)+gray(left+p.x,top+p.y-3)+gray(left+p.x,top+p.y+3))/4;
      scores.push({ left, score: edge/boundary.length });
    }
    scores.sort((a,b)=>b.score-a.score);
    const best=scores[0]; const other=scores.find(s=>Math.abs(s.left-best.left)>8/displayScale);
    if (!best || !other || best.score<8 || best.score-other.score<2) return {error:'轮廓匹配置信度不足',best,other};
    return { offset: best.left*displayScale-geometry.piece.left, left:best.left*displayScale, referenceWidth:geometry.bg.width, score:best.score, alternative:other.score, threshold };
    };
    const primary = detect(170);
    if (!primary.error) return primary;
    // 明亮背景可能和低阈值描边连成大块；提高阈值分离轮廓，但不降低匹配置信度。
    const alternatives = [210, 235, 245].map(detect).filter(e => !e.error);
    if (alternatives.length >= 2 && alternatives.every(e => Math.abs(e.left - alternatives[0].left) / displayScale <= 3)) return alternatives[0];
    return { ...primary, fallbackAgreement: alternatives.length, error: alternatives.length > 1 ? '轮廓阈值匹配结果不一致' : primary.error };
  }, { geometry, images });
  if (!estimate||estimate.error) throw new Error('验证码缺口定位置信度不足：'+JSON.stringify(estimate));
  return estimate;
}
export async function solveCaptcha(page, root, { artifactDir = `${root}artifacts/` } = {}) {
  const iframe = page.locator('#tcaptcha_iframe_dy');
  await iframe.waitFor({ state: 'visible', timeout: 15000 });
  const frame = await (await iframe.elementHandle()).contentFrame();
  await frame.locator('#slideBg').waitFor({ state: 'visible', timeout: 15000 });
  const estimate = await locateSlider(page, frame, root, { artifactDir });
  console.log('腾讯滑块定位偏移：' + estimate.offset.toFixed(1));
  const slider = await frame.locator('.tc-slider-normal').boundingBox();
  if (!slider) throw new Error('滑块不可见');
  const screenScale=await frame.locator('#slideBg').evaluate((e,width)=>e.getBoundingClientRect().width/width,estimate.referenceWidth);
  const distanceTarget=estimate.offset*screenScale;
  const leftTarget=estimate.left*screenScale;
  const x=slider.x+slider.width/2,y=slider.y+slider.height/2;
  await page.mouse.move(x,y); await page.mouse.down();
  for(let i=1;i<=55;i++) {
    const p=i/55;
    const distance=p<0.85?(distanceTarget+2)*(1-(1-p/0.85)**2):distanceTarget+2*(1-(p-0.85)/0.15);
    await page.mouse.move(x+distance,y+2*Math.sin(p*Math.PI*2));
    await page.waitForTimeout(18+Math.floor(Math.random()*25));
  }
  const actual = await frame.evaluate(() => {
    const bg=document.querySelector('#slideBg');
    const piece=[...document.querySelectorAll('.tc-fg-item')].find(e=>!e.classList.contains('tc-slider-normal')&&parseFloat(e.style.width)<120&&getComputedStyle(e).backgroundImage!=='none'&&getComputedStyle(e).cursor==='pointer');
    return piece.getBoundingClientRect().left-bg.getBoundingClientRect().left;
  });
  if(artifactDir) {
    await writeFile(`${artifactDir}drag.json`,JSON.stringify({estimate,actual},null,2));
    await iframe.screenshot({path:`${artifactDir}captcha-before-release.png`});
  }
  console.log('目标位置：'+leftTarget.toFixed(1)+'；拖动后位置：'+actual.toFixed(1));
  // 组件可能将鼠标距离换算为拼图距离，用实际页面位置进行末端校正。
  if(Math.abs(leftTarget-actual)>0.7) {
    await page.mouse.move(x+distanceTarget+(leftTarget-actual),y,{steps:5});
    await page.waitForTimeout(120);
  }
  await page.mouse.up();
  return estimate;
}
import { writeFile } from 'node:fs/promises';
