import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {createApp} from '../../src/server/app.js';
import {loadConfig} from '../../src/server/config.js';
import {browserOptions} from './browser-options.mjs';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nib-minute-browser-'));
let clock=Date.now(),calls=0;const start=clock,errors=[];
const runtime=createApp({directory,publicDirectory:path.resolve('dist/public'),now:()=>clock,
 config:loadConfig({DEMO_MODE:'false',OPENAI_API_ENABLED:'true',OPENAI_API_KEY:'mock-key-never-used',OPENAI_MAX_CALLS_PER_HOUR:'0',OPENAI_DAILY_BUDGET_ENABLED:'false'}),
 schedule:()=>1,unschedule(){},createSocket(){throw new Error('External Twitch forbidden');},
 clientFactory:async()=>({responses:{create:async request=>{calls++;return{status:'completed',usage:{input_tokens:200,output_tokens:60},output_text:JSON.stringify({window_id:JSON.parse(request.input[0].content).window_id,scores:{calm:5,laughter:10,excitement:80,anger:0,confusion:5},reason:'Chat feels upbeat.'})};}}})});
const server=runtime.app.listen(0,'127.0.0.1');await once(server,'listening');runtime.start();runtime.ai.setConnected(true);
const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch(browserOptions());
fs.mkdirSync('artifacts/minute-sentiment',{recursive:true});
try{
 const context=await browser.newContext({viewport:{width:1280,height:1100}});
 await context.route('**/*',r=>r.request().url().startsWith(base+'/')?r.continue():r.abort());
 const pages=[await context.newPage(),await context.newPage()];
 for(const[page,url]of[[pages[0],base],[pages[1],base+'/?overlay=1']]){page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.locator('#world[data-mascot-count="1"]').waitFor({state:'attached'});}
 for(let i=0;i<5;i++){clock+=1000;runtime.receive({text:'GG '+i,userId:'one-viewer'});}
 assert.equal(await runtime.ai.analyze(),false);assert.equal(calls,0);
 await pages[0].getByText('5/5 messages',{exact:false}).waitFor();
 assert.equal(await pages[0].locator('#interval').inputValue(),'60');assert.equal(await pages[0].locator('#interval').evaluate(e=>e.readOnly),true);
 assert.match(await pages[0].locator('#ai-note').textContent(),/no hourly call limit/);
 assert.equal(await pages[0].locator('#daily-budget-unlimited').isChecked(),true);assert.equal(await pages[0].locator('#budget').isDisabled(),true);assert.equal(await pages[0].locator('#remaining').textContent(),'Unlimited');
 clock=start+60000;assert.equal(await runtime.ai.analyze(),true);
 for(const page of pages){await page.waitForFunction(()=>document.getElementById('world').dataset.evolutionForm==='blaze',{},{timeout:20000});assert.match(await page.locator('#world').getAttribute('aria-label'),/excitement 80%/);}
 await pages[1].locator('#world').screenshot({path:'artifacts/minute-sentiment/ai-scores-overlay.png',omitBackground:true});
 for(let i=0;i<4;i++){clock+=1000;runtime.receive({text:'GG next '+i,userId:'one-viewer'});}clock=start+120000;assert.equal(await runtime.ai.analyze(),false);
 for(const page of pages){await page.waitForFunction(()=>document.getElementById('world').dataset.evolutionForm==='base',{},{timeout:20000});assert.equal(Number(await page.locator('#world').getAttribute('data-frame-errors')||0),0);}
 const alpha=await pages[1].locator('#world').evaluate(c=>c.getContext('2d').getImageData(0,0,1,1).data[3]);assert.equal(alpha,0);assert.equal(calls,1);assert.deepEqual(errors,[]);
 await pages[0].locator('#daily-budget-unlimited').uncheck();await pages[0].locator('#budget').fill('0.00');
 await Promise.all([pages[0].waitForResponse('**/api/ai/settings'),pages[0].locator('#settings-form button[type="submit"]').click()]);
 assert.equal(runtime.store.state.settings.dailyBudgetEnabled,true);assert.equal(runtime.store.state.settings.dailyBudget,0);
 await pages[0].locator('#daily-budget-unlimited').check();
 await Promise.all([pages[0].waitForResponse('**/api/ai/settings'),pages[0].locator('#settings-form button[type="submit"]').click()]);
 assert.equal(runtime.store.state.settings.dailyBudgetEnabled,false);assert.equal(runtime.store.state.settings.dailyBudget,0);assert.equal(calls,1);
 fs.writeFileSync('artifacts/minute-sentiment/result.json',JSON.stringify({result:'passed',mockCalls:calls,realAPICalls:0,errors,alpha},null,2));
 console.log('Minute AI browser passed: one viewer/five GG → AI scores and evolved form in both views; four messages → base; fixed 60s UI; transparent overlay; zero real API calls.');
}finally{await browser.close();runtime.stop();await new Promise(r=>server.close(r));fs.rmSync(directory,{recursive:true,force:true});}
