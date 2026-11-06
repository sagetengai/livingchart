// Explicitly reuse an installed Playwright module; never installs dependencies.
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
if(!process.argv[2])throw new Error('Pass the absolute path to an installed playwright module');
const {chromium}=require(process.argv[2]);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const output=path.join(root,'artifacts/phase-1-geography');
const browser=await chromium.launch({headless:true});
const results=[];
try{
 for(const width of [1920,3840])for(const source of ['image','tiles']){
  const page=await browser.newPage({viewport:{width,height:width*9/16},deviceScaleFactor:1});
  const errors=[],badResponses=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  page.on('requestfailed',r=>errors.push(r.url()+': '+r.failure()?.errorText));
  page.on('response',r=>{if(r.status()>=400)badResponses.push({url:r.url(),status:r.status()})});
  await page.goto(`http://127.0.0.1:8091/experiments/phase-1-geography/preview.html?capture=1&source=${source}`);
  await page.waitForFunction(()=>window.preview?.ready,{},{timeout:30000});
  const diagnostics=await page.evaluate(()=>{
   const p=window.preview,canvas=p.map.getCanvas(),gl=canvas.getContext('webgl2');
   const debug=gl.getExtension('WEBGL_debug_renderer_info');
   return {maplibre:p.map.version,canvas:[canvas.width,canvas.height],bounds:p.map.getBounds().toArray(),
    renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null,glError:gl.getError(),mapErrors:p.errors,
    resources:performance.getEntriesByType('resource').filter(r=>r.name.includes('/artifacts/')).map(r=>({url:r.name,bytes:r.decodedBodySize})),
    elapsedToReadyMs:performance.now()};
  });
  await page.screenshot({path:path.join(output,`maplibre-${source}-${width}.png`)});
  if(source==='image'&&width===1920){
   await page.evaluate(()=>document.body.classList.remove('capture'));
   await page.evaluate(()=>window.preview.map.resize());
   await page.selectOption('#palette','muted-teal');
   await page.waitForFunction(()=>window.preview.ready);
   await page.selectOption('#source','tiles');
   await page.waitForFunction(()=>window.preview.ready);
   if(!await page.locator('#palette').isDisabled())throw new Error('Tile mode must lock its palette');
   await page.selectOption('#source','image');
   await page.waitForFunction(()=>window.preview.ready);
   await page.locator('#reset').click();
   await page.screenshot({path:path.join(output,'interactive-preview.png')});
  }
  results.push({width,height:width*9/16,source,errors,badResponses,diagnostics});
  await page.close();
 }
}finally{await browser.close()}
fs.writeFileSync(path.join(output,'browser-audit.json'),JSON.stringify({testedAt:new Date().toISOString(),note:'Software/headless evidence only; no native GPU performance certification.',results},null,2)+'\n');
console.log(JSON.stringify(results.map(r=>({width:r.width,source:r.source,errors:r.errors,badResponses:r.badResponses,glError:r.diagnostics.glError,mapErrors:r.diagnostics.mapErrors,artifactRequests:r.diagnostics.resources.length,artifactBytes:r.diagnostics.resources.reduce((a,r)=>a+r.bytes,0)})),null,2));
if(results.some(r=>r.errors.length||r.badResponses.length||r.diagnostics.glError||r.diagnostics.mapErrors.length))process.exitCode=1;
