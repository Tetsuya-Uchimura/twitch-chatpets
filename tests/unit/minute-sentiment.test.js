import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadConfig} from '../../src/server/config.js';
import {Store} from '../../src/server/store.js';
import {ChatWindow} from '../../src/server/chat.js';
import {ChatPulse} from '../../src/server/pulse.js';
import {NibEvolution} from '../../src/server/evolution.js';
import {MinuteSentiment} from '../../src/server/minute-sentiment.js';
import {createApp} from '../../src/server/app.js';
import {acquireAILease} from '../../src/server/ai-lease.js';

const hype={calm:5,laughter:10,excitement:80,anger:0,confusion:5};
function fixture(t,env={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nib-minute-'));let clock=100000,sequence=0;
 const config=loadConfig({DEMO_MODE:'false',OPENAI_API_ENABLED:'true',OPENAI_API_KEY:'mock-only-key',...env});
 const now=()=>clock,store=new Store(directory,config),pulse=new ChatPulse({...config.pulse,aiDriven:true},now),chat=new ChatWindow(config,now),evolution=new NibEvolution();
 const calls=[],timers=new Map();let timerId=0;
 const response=(request,scores=hype)=>({status:'completed',usage:{input_tokens:200,output_tokens:60},output_text:JSON.stringify({window_id:JSON.parse(request.input[0].content).window_id,scores,reason:'Chat feels upbeat.'})});
 const client={responses:{create:async(request,options)=>{calls.push({request,options});return response(request);}}};
 const ai=new MinuteSentiment({config,store,chat,pulse,now,clientFactory:async()=>client,schedule:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},unschedule:id=>timers.delete(id),apply:()=>evolution.observe(pulse.snapshot())});ai.setConnected(true);
 t.after(()=>{ai.stop();fs.rmSync(directory,{recursive:true,force:true});});
 return{ai,pulse,store,config,evolution,calls,timers,client,response,now,at(ms){clock=100000+ms;},add(text='GG',participant='only-viewer',options){clock+=1000;const message={sequence:++sequence,at:clock,text,participant};pulse.ingest(message);ai.ingest(message,options);},minute(){clock=160000;pulse.snapshot();}};
}

test('one viewer and five keyword-unknown messages get one contextual AI result, then an empty minute resets base without a call',async t=>{
 const f=fixture(t);for(let i=0;i<5;i++)f.add('GG '+i);
 f.at(59999);assert.equal(await f.ai.analyze(),false);assert.equal(f.calls.length,0);
 f.minute();assert.equal(f.pulse.snapshot().participants,1);assert.equal(f.pulse.snapshot().classified,0);assert.equal(f.pulse.snapshot().insufficient,false);
 assert.equal(await f.ai.analyze(),true);assert.equal(f.calls.length,1);assert.equal(f.evolution.form,'blaze');assert.equal(f.pulse.snapshot().fractions.excitement,.8);
 const {request,options}=f.calls[0],input=JSON.parse(request.input[0].content);
 assert.equal(input.messages.length,5);assert.ok(!JSON.stringify(input).includes('only-viewer'));assert.equal(input.total_messages,5);
 assert.equal(request.model,'gpt-6-luna');assert.equal(request.text.format.strict,true);assert.deepEqual(request.text.format.schema.properties.window_id.enum,[input.window_id]);assert.equal(options.maxRetries,0);
 assert.equal(await f.ai.analyze(),false);assert.equal(f.calls.length,1);
 f.at(120000);f.evolution.observe(f.pulse.snapshot());assert.equal(f.evolution.form,'base');assert.equal(await f.ai.analyze(),false);assert.equal(f.calls.length,1);
});

test('four accepted messages skip SDK; five accepted messages cross the threshold',async t=>{
 for(const n of [4,5]){const f=fixture(t);for(let i=0;i<n;i++)f.add('GG '+i);f.minute();assert.equal(await f.ai.analyze(),n===5);assert.equal(f.calls.length,n===5?1:0);}
});

test('AI scores directly choose each minute without local-keyword, dominance or old-emotion veto',async t=>{
 const f=fixture(t);f.client.responses.create=async request=>f.response(request,{calm:10,laughter:29,excitement:31,anger:20,confusion:10});
 for(let i=0;i<5;i++)f.add('LOL '+i);f.minute();await f.ai.analyze();assert.equal(f.evolution.form,'blaze');
 for(let i=0;i<5;i++)f.add('LOL next '+i);f.at(120000);await f.ai.analyze();assert.equal(f.pulse.snapshot().analysisStatus,'ready');
});

test('minute scheduling stays on the boundary after slow inference rather than adding its latency',async t=>{
 const f=fixture(t);for(let i=0;i<5;i++)f.add('GG '+i);
 const timer=f.timers.values().next().value;assert.equal(timer.ms,60000);
 f.client.responses.create=async request=>{f.at(65000);return f.response(request);};f.at(60000);await timer.fn();
 assert.equal(f.ai.nextAnalysis,220000);assert.equal([...f.timers.values()].at(-1).ms,55000);
});

test('hourly cap, daily budget and shared conversation lease visibly skip without sending',async t=>{
 for(const mode of ['hourly','budget','busy']){const f=fixture(t);for(let i=0;i<5;i++)f.add('GG '+i);f.minute();let release;
  if(mode==='hourly')for(let i=0;i<20;i++)f.store.reserve({id:'used-'+i,timestamp:f.now(),model:f.config.model,inputTokens:1,outputTokens:1,estimatedCost:.00001,reservedCost:0,status:'success',purpose:'reaction'});
  if(mode==='budget')f.store.settings({...f.store.state.settings,dailyBudget:0});
  if(mode==='busy')release=acquireAILease(f.store);
  assert.equal(await f.ai.analyze(),false);release?.();assert.equal(f.calls.length,0);assert.equal(f.pulse.snapshot().analysisStatus,{hourly:'hourly_limit',budget:'budget_limit',busy:'ai_busy'}[mode]);
 }
});
test('zero hourly cap permits live minute sentiment after twenty shared calls, preserving the daily budget',async t=>{
 const f=fixture(t,{OPENAI_MAX_CALLS_PER_HOUR:'0'});
 for(let i=0;i<20;i++)f.store.reserve({id:'prior-'+i,timestamp:f.now(),model:f.config.model,purpose:'reaction',inputTokens:1,outputTokens:1,estimatedCost:.00001,reservedCost:0,status:'success'});
 for(let i=0;i<5;i++)f.add('GG '+i);f.minute();assert.equal(await f.ai.analyze(),true);assert.equal(f.evolution.form,'blaze');assert.equal(f.ai.snapshot().hourlyLimit,0);
 f.ai.updateSettings({dailyBudget:0});for(let i=0;i<5;i++)f.add('GG next '+i);f.at(120000);assert.equal(await f.ai.analyze(),false);assert.equal(f.pulse.snapshot().analysisStatus,'budget_limit');assert.equal(f.calls.length,1);
});
test('daily budget OFF allows minute scores beyond the amount, retaining costs and the shared lease',async t=>{
 const f=fixture(t,{OPENAI_MAX_CALLS_PER_HOUR:'0',OPENAI_DAILY_BUDGET_ENABLED:'false'});
 f.store.reserve({id:'spent',timestamp:f.now(),model:f.config.model,purpose:'reaction',inputTokens:1,outputTokens:1,estimatedCost:.5,reservedCost:0,status:'success'});
 for(let i=0;i<5;i++)f.add('GG '+i);f.minute();assert.equal(await f.ai.analyze(),true);assert.equal(f.evolution.form,'blaze');assert.ok(f.store.totals(f.now()).dailySpent>.5);
 for(let i=0;i<5;i++)f.add('GG next '+i);f.at(120000);const release=acquireAILease(f.store);assert.equal(await f.ai.analyze(),false);release();assert.equal(f.pulse.snapshot().analysisStatus,'ai_busy');assert.equal(f.calls.length,1);
});

test('unsafe, private and opted-out text are excluded; batch text stays bounded and identities never leave',async t=>{
 const f=fixture(t);f.add('api_key sk-secret');f.add('I was diagnosed with something');f.add('secret optout','person',{excluded:true});
 for(let i=0;i<120;i++){f.at(4000+i*100);f.add('GG '+i+' x'.repeat(80));}
 // Only the last minute counts, irrespective of old retained records.
 f.minute();f.client.responses.create=async(request,options)=>{f.calls.push({request,options});return f.response(request);};await f.ai.analyze();
 const input=JSON.parse(f.calls[0].request.input[0].content);assert.ok(input.messages.length<=100);assert.ok(input.messages.reduce((n,s)=>n+s.length,0)<=8000);assert.doesNotMatch(JSON.stringify(input),/sk-secret|diagnosed|secret optout|only-viewer/);
});

test('wrong-window, incomplete, zero-score and missing-usage responses never evolve and still account usage',async t=>{
 for(const mode of ['window','incomplete','zero','usage']){const f=fixture(t);for(let i=0;i<5;i++)f.add('GG '+i);f.minute();
  f.client.responses.create=async request=>{const response=f.response(request);if(mode==='window')response.output_text=response.output_text.replace('minute-0-160000','wrong');if(mode==='incomplete')response.status='incomplete';if(mode==='zero')response.output_text=JSON.stringify({window_id:'minute-0-160000',scores:{calm:0,laughter:0,excitement:0,anger:0,confusion:0},reason:'test'});if(mode==='usage')delete response.usage;return response;};
  assert.equal(await f.ai.analyze(),false);assert.equal(f.evolution.form,'base');assert.equal(f.store.state.records[0].status,'failure');assert.ok(f.store.totals(f.now()).dailySpent>0);
 }
});

test('late output cannot overwrite the next empty minute or apply after disconnect, disable or forget',async t=>{
 for(const mode of ['late','disconnect','disable','forget']){const f=fixture(t);for(let i=0;i<5;i++)f.add('GG '+i);f.minute();let resolve,request;
  f.client.responses.create=async value=>{request=value;return new Promise(r=>resolve=r);};const job=f.ai.analyze();await new Promise(r=>setImmediate(r));
  if(mode==='late'){f.at(120000);f.evolution.observe(f.pulse.snapshot());}if(mode==='disconnect')f.ai.setConnected(false);if(mode==='disable')f.ai.updateSettings({enabled:false});if(mode==='forget')f.ai.forget('only-viewer');
  resolve(f.response(request));assert.equal(await job,false);assert.equal(f.evolution.form,'base');assert.equal(f.pulse.snapshot().evolutionEligible,false);
 }
});

test('unresponsive provider times out once and releases the shared lease without a retry',async t=>{
 const f=fixture(t,{OPENAI_TIMEOUT_MS:'100'});for(let i=0;i<5;i++)f.add('GG '+i);f.minute();f.client.responses.create=async()=>new Promise(()=>{});
 const keeper=setTimeout(()=>{},1000);try{assert.equal(await f.ai.analyze(),false);}finally{clearTimeout(keeper);}
 assert.equal(f.ai.lastError,'timeout');assert.equal(f.store.state.records.length,1);const release=acquireAILease(f.store);assert.ok(release);release();
});

test('live application routes a single viewer minute to AI and returns to base on four or zero messages',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nib-minute-app-'));let clock=100000,calls=0;
 const runtime=createApp({directory,now:()=>clock,config:loadConfig({DEMO_MODE:'false',OPENAI_API_ENABLED:'true',OPENAI_API_KEY:'mock-only-key'}),schedule:()=>1,unschedule(){},clientFactory:async()=>({responses:{create:async request=>{calls++;return{status:'completed',usage:{input_tokens:100,output_tokens:50},output_text:JSON.stringify({window_id:JSON.parse(request.input[0].content).window_id,scores:hype,reason:'Lively conversation.'})};}}})});
 t.after(()=>{runtime.stop();fs.rmSync(directory,{recursive:true,force:true});});runtime.ai.setConnected(true);
 for(let i=0;i<5;i++){clock+=1000;assert.equal(runtime.receive({text:'GG '+i,userId:'one'}),true);}clock=160000;
 assert.equal(await runtime.ai.analyze(),true);assert.equal(runtime.snapshot().evolution.form,'blaze');assert.equal(calls,1);
 for(let i=0;i<4;i++){clock+=1000;runtime.receive({text:'GG next '+i,userId:'one'});}clock=220000;assert.equal(runtime.snapshot().evolution.form,'base');assert.equal(await runtime.ai.analyze(),false);assert.equal(calls,1);
});
