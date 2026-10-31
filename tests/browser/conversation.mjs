import { chromium } from '@playwright/test';
import { browserOptions } from './browser-options.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../../src/server/app.js';
import { loadConfig } from '../../src/server/config.js';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nib-conversation-browser-'));
let clock=Date.UTC(2026,9,29,10), api=0;
const runtime=createApp({directory,publicDirectory:path.resolve('dist/public'),now:()=>clock,
 config:loadConfig({DEMO_MODE:'true',OPENAI_API_KEY:'never-used-demo-test'}),clientFactory(){api++;throw new Error('API forbidden in demo');}});
const server=runtime.app.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`, browser=await chromium.launch(browserOptions());
const errors=[],external=[],trace=[];fs.mkdirSync('artifacts/conversation',{recursive:true});
let page,overlay;
try{
 const context=await browser.newContext({viewport:{width:1280,height:1150}});
 await context.route('**/*',route=>{if(!route.request().url().startsWith(base+'/')){external.push(route.request().url());return route.abort();}return route.continue();});
 const post=async(url,data)=>{const r=await context.request.post(base+url,{data});assert.ok(r.ok());return r.json();};
 const flush=()=>new Promise(r=>setTimeout(r,50));
 page=await context.newPage();overlay=await context.newPage();
 await page.clock.install({time:clock});
 for(const[p,url]of[[page,base],[overlay,base+'/?overlay=1']]){p.on('pageerror',e=>errors.push(e.message));await p.goto(url);await p.locator('#world[data-mascot-count="1"]').waitFor({state:'attached'});}
 await page.clock.pauseAt(await page.evaluate(()=>Date.now()+100));
 const advance=async(ms)=>{clock+=ms;await flush();await page.clock.runFor(ms);await flush();};
 const sample=async()=>{const all=[];for(const p of[page,overlay]){const s=await p.locator('#world').evaluate(c=>({speech:c.dataset.speechText,id:c.dataset.speechId,emoting:c.dataset.speechEmoting,started:c.dataset.speechStarted,animation:c.dataset.speechAnimation,action:c.dataset.actions,form:c.dataset.evolutionForm,event:c.dataset.conversationEvent,pixels:+c.dataset.spritePixels,errors:+(c.dataset.frameErrors||0),alpha:c.getContext('2d').getImageData(0,0,1,1).data[3]}));assert.ok(s.pixels>300);assert.equal(s.errors,0);if(p===overlay)assert.equal(s.alpha,0);all.push(s);}trace.push(all);return all;};
 await page.locator('#conversation-input').fill('Nib, did you eat all the snacks?');await Promise.all([page.waitForResponse('**/api/demo/conversation'),page.locator('#conversation-demo-form button[type=submit]').click()]);
 await runtime.conversation.tick();await advance(2800);
 let views=await sample();for(const s of views){assert.match(s.speech,/snacks/);assert.equal(s.emoting,'true');assert.equal(s.action,'notice');}
 assert.equal(views[0].id,views[1].id);assert.equal(views[0].event,'open');
 await page.screenshot({path:'artifacts/conversation/workspace.png',fullPage:true});await overlay.locator('#world').screenshot({path:'artifacts/conversation/overlay-reply.png',omitBackground:true});
 assert.equal(await overlay.locator('#conversation-panel').count(),0);assert.equal(await overlay.locator('.right-column').isVisible(),false);
 await advance(6000);await Promise.all([page.waitForResponse('**/api/demo/conversation'),page.locator('[data-conversation-example="!answer Let\'s split them half and half!"]').click()]);await runtime.conversation.tick();await advance(2800);
 views=await sample();for(const s of views)assert.match(s.speech,/half and half/);
 await advance(6000);await post('/api/conversation/event',{kind:'question'});await runtime.conversation.tick();await advance(80);
 await post('/api/demo/conversation',{userId:'alice',text:'!answer 30'});await post('/api/demo/conversation',{userId:'bob',text:'!answer 100'});
 assert.equal(runtime.conversation.eventView().participants,2);await advance(31000);await runtime.conversation.tick();await advance(2800);
 views=await sample();for(const s of views)assert.match(s.speech,/Average: 65!/);
 await advance(6000);await post('/api/conversation/event',{kind:'poll'});await runtime.conversation.tick();await advance(1200);
 for(const[userId,text]of[['alice','!vote 1'],['bob','!vote 2'],['alice','!vote 2']]){await post('/api/demo/conversation',{userId,text});await advance(1000);}
 assert.deepEqual(runtime.conversation.eventView().counts,[1,1]);
 await overlay.locator('#world').screenshot({path:'artifacts/conversation/overlay-poll.png',omitBackground:true});
 await advance(31000);await runtime.conversation.tick();await advance(2800);views=await sample();for(const s of views)assert.match(s.speech,/a tie!/);
 // Old-form output is cleared during a transformation. New-form speech waits for its reveal/landing.
 await advance(6000);await post('/api/demo/pulse',{scenario:'excitement'});await advance(400);
 await post('/api/demo/conversation',{userId:'charlie',text:"Nib, let's all cheer together!"});await runtime.conversation.tick();await advance(700);
 views=await sample();for(const s of views)assert.equal(s.speech,'');
 await advance(5000);views=await sample();for(const s of views){assert.equal(s.form,'blaze');assert.match(s.speech,/let's go, everyone/);}
 // Lots of ordinary buttons remain harmless while speech and evolution share the stage.
 for(let i=0;i<45;i++)await post('/api/demo/message',{text:`GG ${i}`});await advance(18000);views=await sample();
 await page.setViewportSize({width:390,height:844});await advance(100);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'artifacts/conversation/mobile.png',fullPage:true});
 assert.equal(api,0);assert.equal(runtime.store.totals(clock).totalRequests,0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 fs.writeFileSync('artifacts/conversation/trace.json',JSON.stringify(trace,null,2));
 console.log('Conversation browser passed: viewer → Nib → answer → Nib; ratings average65; unique poll tie; same speech in preview/transparent OBS; evolution arbitration; burst; mobile; zero API.');
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:'artifacts/conversation/failure.png',fullPage:true});fs.writeFileSync('artifacts/conversation/failure.json',JSON.stringify({error:error.message,errors,trace},null,2));throw error;}
finally{await browser.close();runtime.stop();await new Promise(r=>server.close(r));fs.rmSync(directory,{recursive:true,force:true});}
