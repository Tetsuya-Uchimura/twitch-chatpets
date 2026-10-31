import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once, EventEmitter} from 'node:events';
import {createApp} from '../../src/server/app.js';
import {loadConfig} from '../../src/server/config.js';
import {browserOptions} from './browser-options.mjs';

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nib-stream-browser-'));
let clock=Date.now(),calls=0,captures=0;const start=clock,errors=[];
const joke='The menu has more patience than our snack supply.';
const runtime=createApp({directory,publicDirectory:path.resolve('dist/public'),now:()=>clock,
  config:loadConfig({DEMO_MODE:'false',OPENAI_API_KEY:'mock-only',TWITCH_CHANNEL:'test_channel'}),
  schedule:()=>1,unschedule(){},createSocket(){return Object.assign(new EventEmitter(),{send(){},close(){},terminate(){}});},
  streamFrame:{configured:true,async capture(){captures++;return{dataURL:'data:image/jpeg;base64,/9j/2Q==',fetchedAt:clock,maxAgeSeconds:300};}},
  clientFactory:async()=>({responses:{async create(request){calls++;const payload=JSON.parse(request.input[0].content[0].text);return{status:'completed',usage:{input_tokens:350,output_tokens:40},output_text:JSON.stringify({should_reply:true,candidate_id:payload.candidate.id,reply:joke,animation:'laugh',evidence_ids:payload.evidence.map(e=>e.id),followup:null})};}}})});
const server=runtime.app.listen(0,'127.0.0.1');await once(server,'listening');
runtime.start();
runtime.conversation.updateSettings({liveAIEnabled:true,streamJokesEnabled:true});runtime.conversation.setConnected(true);runtime.streamJokes.setConnected(true);
const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch(browserOptions());
fs.mkdirSync('artifacts/stream-jokes',{recursive:true});
try{
 const context=await browser.newContext({viewport:{width:1280,height:1100}});
 await context.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
 const pages=[await context.newPage(),await context.newPage()];
 for(const[page,url]of[[pages[0],base],[pages[1],base+'/?overlay=1']]){page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.locator('#world[data-mascot-count="1"]').waitFor({state:'attached'});}
 await pages[0].locator('#stream-joke-status').getByText('Collecting the last 10 minutes',{exact:false}).waitFor();
 clock=start+1000;runtime.receive({text:'The menu is taking a snack break.',userId:'viewer-one'});
 clock=start+599999;assert.equal(await runtime.streamJokes.tick(),false);assert.equal(calls,0);
 clock=start+600000;assert.equal(await runtime.streamJokes.tick(),true);assert.equal(await runtime.conversation.tick(),true);
 // Speech is emitted through the real SSE connection; advance its reveal without a paid request.
 clock+=2800;
 for(const page of pages){await page.waitForFunction(text=>document.getElementById('world').dataset.speechText===text,joke,{timeout:12000});assert.equal(Number(await page.locator('#world').getAttribute('data-frame-errors')||0),0);}
 assert.equal(calls,1);assert.equal(captures,1);
 const alpha=await pages[1].locator('#world').evaluate(c=>c.getContext('2d').getImageData(0,0,1,1).data[3]);assert.equal(alpha,0);
 await pages[1].locator('#world').screenshot({path:'artifacts/stream-jokes/overlay.png',omitBackground:true});
 await pages[0].locator('#conversation-settings').evaluate(f=>f.closest('details').open=true);
 assert.equal(await pages[0].locator('input[name="streamJokesEnabled"]').isChecked(),true);
 await pages[0].locator('input[name="streamJokesEnabled"]').uncheck();
 await Promise.all([pages[0].waitForResponse('**/api/conversation/settings'),pages[0].locator('#conversation-settings button[type="submit"]').click()]);
 await pages[0].locator('#stream-joke-status').getByText('OFF',{exact:false}).waitFor();
 clock+=600000;assert.equal(await runtime.streamJokes.tick(),false);assert.equal(calls,1);assert.deepEqual(errors,[]);
 fs.writeFileSync('artifacts/stream-jokes/result.json',JSON.stringify({result:'passed',mockCalls:calls,realAPICalls:0,captures,alpha,errors},null,2));
 console.log('Stream jokes browser passed: ten-minute image/chat job → same joke/emote in preview and transparent OBS; UI OFF stops jobs; zero real API calls.');
}finally{await browser.close();runtime.stop();await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});}
