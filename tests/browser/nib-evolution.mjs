import{chromium}from'@playwright/test';import assert from'node:assert/strict';import fs from'node:fs';import path from'node:path';import os from'node:os';import{once}from'node:events';
import{createApp}from'../../src/server/app.js';import{loadConfig}from'../../src/server/config.js';import{EMOTION_FORM}from'../../src/shared/nib-forms.js';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nib-evolution-'));let clock=null,sdk=0,sockets=0,jobs=0;
const runtime=createApp({directory,publicDirectory:path.resolve('dist/public'),now:()=>clock??Date.now(),config:loadConfig({DEMO_MODE:'true',OPENAI_API_ENABLED:'true',OPENAI_API_KEY:'unused-nib-evolution-sentinel'}),clientFactory(){sdk++;throw new Error('API forbidden');},schedule(){jobs++;return 1;},createSocket(){sockets++;throw new Error('Twitch forbidden');}});
const server=runtime.app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;const epoch=runtime.snapshot().pulse.windowEnd;
import {browserOptions} from './browser-options.mjs';
const browser=await chromium.launch(browserOptions());const errors=[],external=[],rosterAssets=[],trace=[];let preview;
fs.mkdirSync('artifacts/nib-evolution',{recursive:true});
try{
 const context=await browser.newContext({viewport:{width:1200,height:1000}});
 await context.route('**/*',r=>{const url=r.request().url();if(!url.startsWith(base+'/')){external.push(url);return r.abort();}if(/\/cast\/|\/character-lab\//.test(url))rosterAssets.push(url);return r.continue();});context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 await context.request.post(base+'/api/demo/playback',{data:{enabled:false}});
 // Persisted old choices cannot bring a second character back into the live renderer.
 await context.request.patch(base+'/api/stage/settings',{data:{selectedCast:'bront',castMode:'random'}});
 preview=await context.newPage();await preview.clock.install();const overlay=await context.newPage();
 for(const[page,url]of[[preview,base],[overlay,base+'/?overlay=1']]){await page.goto(url);await page.locator('#world[data-evolution-form=base][data-mascot-count="1"]').waitFor({state:'attached',timeout:30000});}
 await preview.clock.pauseAt(await preview.evaluate(()=>Date.now()+300));
 assert.equal(await preview.locator('[data-cast-choice]').count(),0);assert.equal(await overlay.locator('.evolution-panel').isVisible(),false);
 const sample=async label=>{for(const page of[preview,overlay]){const s=await page.locator('#world').evaluate(c=>({cast:c.dataset.cast,form:c.dataset.evolutionForm,target:c.dataset.evolutionTarget,pending:c.dataset.evolutionPending,pixels:+c.dataset.spritePixels,errors:+(c.dataset.frameErrors||0),count:c.dataset.mascotCount,alpha:c.getContext('2d').getImageData(0,0,1,1).data[3]}));assert.equal(s.cast,'nib');assert.equal(s.count,'1');assert.ok(s.pixels>300);assert.equal(s.errors,0);if(page===overlay)assert.equal(s.alpha,0);trace.push({label,...s});}};
 await sample('ordinary');clock=epoch+1000;
 for(let i=0;i<8;i++){clock+=1000;runtime.receive({text:'LOL 😂 '+i,userId:'minute-'+i});}
 assert.equal(runtime.snapshot().evolution.form,'base');clock=epoch+59999;assert.equal(runtime.snapshot().evolution.form,'base');clock=epoch+60000;assert.equal(runtime.snapshot().evolution.form,'giggle');
 await context.request.post(base+'/api/demo/playback',{data:{enabled:false}});await preview.clock.fastForward(60000);await preview.clock.runFor(3400);
 for(const page of[preview,overlay])assert.equal(await page.locator('#world').getAttribute('data-evolution-form'),'giggle');await sample('real-minute');
 for(const[emotion,form]of Object.entries(EMOTION_FORM)){
  const response=await context.request.post(base+'/api/demo/pulse',{data:{scenario:emotion}});assert.equal(response.status(),200);await preview.clock.runFor(3500);
  for(const page of[preview,overlay])assert.equal(await page.locator('#world').getAttribute('data-evolution-form'),form);
  await sample(emotion);await preview.locator('#world').screenshot({path:`artifacts/nib-evolution/${form}.png`,omitBackground:true});
 }
 await context.request.post(base+'/api/demo/pulse',{data:{scenario:'spike'}});await preview.clock.runFor(3500);assert.equal(runtime.snapshot().evolution.form,'bloom');await sample('spike-is-not-hype');
 // A form change must wait for the current real interaction, even with queued input.
 const act=await context.request.post(base+'/api/demo/interaction',{data:{mood:'calm',intent:'eat'}});assert.equal(act.status(),200);await preview.clock.runFor(250);const before=await preview.locator('#world').getAttribute('data-evolution-form');
 await context.request.post(base+'/api/demo/interaction/reset',{data:{}});await context.request.post(base+'/api/demo/pulse',{data:{scenario:'anger'}});await preview.clock.runFor(100);assert.equal(await preview.locator('#world').getAttribute('data-evolution-form'),before);assert.equal(await preview.locator('#world').getAttribute('data-evolution-pending'),'true');
 await preview.clock.fastForward(4500);await preview.clock.runFor(3400);assert.equal(await preview.locator('#world').getAttribute('data-evolution-form'),'bulwark');
 await preview.locator('#world').evaluate(c=>c.dispatchEvent(new Event('contextrestored')));await preview.clock.runFor(80);await sample('context-restored');
 await preview.clock.fastForward(3600000);await preview.clock.runFor(80);await sample('hidden-hour');
 await preview.screenshot({path:'artifacts/nib-evolution/dashboard.png',fullPage:true});await preview.setViewportSize({width:390,height:844});await preview.clock.runFor(80);assert.ok(await preview.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await preview.screenshot({path:'artifacts/nib-evolution/mobile.png',fullPage:true});
 for(const retired of ['/cast/','/character-lab/'])assert.equal((await context.request.get(base+retired)).status(),404,'retired study assets must not ship');
 await context.close();
 const galleryContext=await browser.newContext({viewport:{width:1200,height:950}});const gallery=await galleryContext.newPage();gallery.on('pageerror',e=>errors.push(e.message));await gallery.goto(base+'/nib-lab/');await gallery.locator('body[data-ready=true]').waitFor({state:'attached'});assert.equal(await gallery.locator('canvas').count(),6);
 for(const action of['idle','walk','happy','eat','jump','attack','sleep','evolve']){await gallery.locator('#action').selectOption(action);await gallery.waitForTimeout(100);assert.ok((await gallery.locator('canvas').evaluateAll(cs=>cs.map(c=>c.dataset.action))).every(x=>x===action));}
 await gallery.locator('#action').selectOption('idle');await gallery.screenshot({path:'artifacts/nib-evolution/gallery.png',fullPage:true});const sheet=await gallery.evaluate(async()=>{const m=await import('./lab.js');return m.exportFormSheet();});fs.writeFileSync('artifacts/nib-evolution/comparison.png',Buffer.from(sheet.split(',')[1],'base64'));
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(rosterAssets,[]);assert.equal(sdk+sockets+jobs,0);
 fs.writeFileSync('artifacts/nib-evolution/trace.json',JSON.stringify(trace,null,2));console.log('Nib evolution passed: 60s decision, six silhouettes/actions, all five emotion demos, volume separation, safe transformation boundary, one Nib in both views, no roster assets, transparency, context/gap recovery, mobile and zero API calls.');
}catch(e){fs.writeFileSync('artifacts/nib-evolution/failure.json',JSON.stringify({error:e.message,errors,external,rosterAssets,trace},null,2));if(preview&&!preview.isClosed())await preview.screenshot({path:'artifacts/nib-evolution/failure.png',fullPage:true});throw e;}
finally{await browser.close();runtime.stop();await new Promise(r=>server.close(r));fs.rmSync(directory,{recursive:true,force:true});}
