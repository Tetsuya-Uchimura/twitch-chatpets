import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once,EventEmitter} from 'node:events';
import {createApp} from '../../src/server/app.js';
import {loadConfig} from '../../src/server/config.js';
import {browserOptions} from './browser-options.mjs';

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nib-visual-browser-'));
let clock=Date.now(),calls=0,captures=0,offline=false;const errors=[];
const frame={configured:true,async capture(){captures++;if(offline)throw new Error('stream_offline');return{dataURL:'data:image/jpeg;base64,/9j/2Q==',fetchedAt:clock,maxAgeSeconds:300};}};
const runtime=createApp({directory,publicDirectory:path.resolve('dist/public'),now:()=>clock,
  config:loadConfig({DEMO_MODE:'false',OPENAI_API_KEY:'mock-only',OPENAI_MAX_CALLS_PER_HOUR:'0',OPENAI_DAILY_BUDGET_ENABLED:'false'}),
  schedule:()=>1,unschedule(){},streamFrame:frame,createSocket(){return Object.assign(new EventEmitter(),{send(){},close(){},terminate(){}});},
  clientFactory:async()=>({responses:{async create(request){calls++;const content=request.input[0].content,p=JSON.parse(Array.isArray(content)?content[0].text:content);
    assert.equal(Array.isArray(content),!offline);if(!offline)assert.equal(content[1].detail,'high');
    return{status:'completed',usage:{input_tokens:500,output_tokens:35},output_text:JSON.stringify({should_reply:true,candidate_id:p.candidate.id,
      reply:offline?'The preview is unavailable. Which obstacle do you mean?':'The preview shows a final, but it may be behind live.',animation:'curious',evidence_ids:p.evidence.slice(-1).map(e=>e.id),followup:null})};}}})});
const server=runtime.app.listen(0,'127.0.0.1');await once(server,'listening');runtime.start();
runtime.conversation.updateSettings({liveAIEnabled:true,displayMs:10000});runtime.conversation.setConnected(true);
for(let i=0;i<25;i++)runtime.conversation.responseLog.append({id:'prior-'+i,at:clock-1000-i,text:'Earlier review entry '+i,source:'Earlier comment',form:'base',animation:'curious',provider:'ai'});
const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch(browserOptions());fs.mkdirSync('artifacts/visual-question',{recursive:true});
try{
  const context=await browser.newContext({viewport:{width:1200,height:1100}});await context.route('**/*',r=>r.request().url().startsWith(base+'/')?r.continue():r.abort());
  const pages=[await context.newPage(),await context.newPage()];
  for(const[p,url]of[[pages[0],base],[pages[1],base+'/?overlay=1']]){p.on('pageerror',e=>errors.push(e.message));await p.goto(url);await p.waitForFunction(()=>Number(document.getElementById('world')?.dataset.spritePixels)>300);}
  for(const [text,user]of[['what round is this?','viewer-one'],['which obstacle is this?','viewer-two']]){
    runtime.receive({text,userId:user});assert.equal(await runtime.conversation.tick(),true);const speech=runtime.conversation.speech;
    for(const page of pages){await page.waitForFunction(id=>document.getElementById('world').dataset.speechId===id,speech.id,{timeout:12000});assert.equal(await page.locator('#world').getAttribute('data-speech-text'),speech.text);assert.equal(Number(await page.locator('#world').getAttribute('data-frame-errors')||0),0);}
    if(!offline){await pages[1].locator('#world').screenshot({path:'artifacts/visual-question/preview-answer.png',omitBackground:true});clock+=31000;offline=true;}
  }
  const history=await context.request.get(base+'/api/conversation/logs').then(r=>r.json());assert.equal(history.totalEntries,27);assert.equal(history.entries[0].visual.status,'stream_offline');assert.equal(history.entries[1].visual.status,'available');
  assert.match(await pages[0].locator('#conversation-history').textContent(),/6 hours/);assert.equal(await pages[0].locator('a[href="/api/conversation/logs"]').count(),1);assert.equal(runtime.snapshot().conversation.logs.length,20);
  const alpha=await pages[1].locator('#world').evaluate(c=>c.getContext('2d').getImageData(0,0,1,1).data[3]);assert.equal(alpha,0);assert.equal(calls,2);assert.equal(captures,2);assert.deepEqual(errors,[]);
  fs.writeFileSync('artifacts/visual-question/result.json',JSON.stringify({result:'passed',mockCalls:calls,realAPICalls:0,historyEntries:history.totalEntries,alpha,errors},null,2));
  console.log('Visual question browser passed: high-detail image answer and offline text fallback in dashboard/transparent OBS; six-hour history includes >20 entries; no real API calls.');
}finally{await browser.close();runtime.stop();await new Promise(r=>server.close(r));fs.rmSync(directory,{recursive:true,force:true});}
