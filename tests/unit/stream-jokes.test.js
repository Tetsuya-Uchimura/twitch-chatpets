import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {loadConfig} from '../../src/server/config.js';
import {createApp} from '../../src/server/app.js';
import {TwitchFrame} from '../../src/server/twitch-frame.js';
import {acquireAILease} from '../../src/server/ai-lease.js';

const image = 'data:image/jpeg;base64,/9j/2Q==';
const config = overrides => loadConfig({DEMO_MODE:'false',OPENAI_API_KEY:'mock-openai-key',TWITCH_CHANNEL:'uttie_pp',TWITCH_CLIENT_ID:'mock-id',TWITCH_CLIENT_SECRET:'mock-secret',...overrides});
function fixture(t, overrides={}) {
  let clock=100000; const calls=[],captures=[];
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nib-stream-jokes-'));
  const frame={configured:true,async capture(signal){captures.push(signal);return{dataURL:image,fetchedAt:clock,maxAgeSeconds:300};}};
  const client={responses:{async create(request,options){calls.push({request,options});const payload=JSON.parse(request.input[0].content[0].text);return{status:'completed',usage:{input_tokens:350,output_tokens:45},output_text:JSON.stringify({should_reply:true,candidate_id:payload.candidate.id,reply:'Even the game menu is waiting for our snack break.',animation:'laugh',evidence_ids:payload.evidence.map(e=>e.id).slice(0,8),followup:null})};}}};
  const runtime=createApp({directory,config:config(overrides),now:()=>clock,streamFrame:frame,clientFactory:async()=>client,schedule:()=>1,unschedule(){}});
  runtime.conversation.updateSettings({liveAIEnabled:!runtime.snapshot().demo,streamJokesEnabled:true});
  runtime.conversation.setConnected(true);runtime.streamJokes.setConnected(true);
  t.after(()=>{runtime.stop();fs.rmSync(directory,{recursive:true,force:true});});
  return{...runtime,frame,client,calls,captures,directory,at(ms){clock=100000+ms;},async generate(){assert.equal(await runtime.streamJokes.tick(),true);return runtime.conversation.tick();}};
}

test('ten-minute job combines early and late comments with one image, emits one speech and shares the ledger',async t=>{
  const f=fixture(t);f.at(1000);f.receive({text:'We are still on the game menu.',userId:'a'});f.at(599000);f.receive({text:'Snack break before the next round.',userId:'b'});
  f.at(599999);assert.equal(await f.streamJokes.tick(),false);assert.equal(f.calls.length,0);assert.equal(f.captures.length,0);
  f.at(600000);assert.equal(await f.generate(),true);assert.equal(f.calls.length,1);assert.equal(f.captures.length,1);
  const {request,options}=f.calls[0],content=request.input[0].content,payload=JSON.parse(content[0].text);
  assert.equal(content[1].type,'input_image');assert.equal(content[1].detail,'low');assert.equal(content[1].image_url,image);
  assert.equal(payload.evidence.length,2);assert.equal(payload.streamContext.end-payload.streamContext.start,600000);assert.equal(payload.streamContext.screenshot_max_age_seconds,300);
  assert.equal(payload.image,undefined);assert.equal(request.store,false);assert.equal(options.maxRetries,0);assert.equal(request.model,'gpt-6-luna');assert.equal(request.text.format.strict,true);
  assert.match(f.conversation.speech.text,/snack break/);assert.equal(f.conversation.speech.animation,'laugh');assert.equal(f.streamJokes.snapshot().status,'spoken');
  assert.equal(f.store.state.records[0].purpose,'stream_joke');assert.equal(f.store.totals(700000).totalRequests,1);
  assert.doesNotMatch(JSON.stringify(f.snapshot()),/data:image|mock-secret|mock-id|mock-openai-key/);
  assert.doesNotMatch(fs.readFileSync(path.join(f.directory,'ai-state.json'),'utf8'),/data:image|snack break|game menu/);
  assert.equal(await f.streamJokes.tick(),false);assert.equal(f.calls.length,1);
});

test('ten-minute buffer expires old comments and samples a bounded window across the whole period',async t=>{
  const f=fixture(t);f.streamJokes.ingest({at:100000,text:'too old'});
  for(let i=1;i<=1200;i++){f.at(i*490);f.streamJokes.ingest({at:100000+i*490,text:'Message '+i+' x'.repeat(80)});}
  assert.equal(f.streamJokes.buffer.length,1000);f.at(600000);await f.streamJokes.tick();
  const candidate=f.conversation.queue.find(c=>c.kind==='stream_joke');assert.ok(candidate.evidence.length<=100);assert.ok(candidate.evidence.reduce((n,e)=>n+e.text.length,0)<=8000);
  assert.doesNotMatch(JSON.stringify(candidate.evidence),/too old/);assert.equal(candidate.streamContext.retained_comments,1000);
});

test('private, opted-out and command messages never enter the ten-minute AI context',async t=>{
  const f=fixture(t);const entries=[['api_key sk-secret','private'],['I was diagnosed with something','private2'],['!jump','command'],['Nice snacks today','opted']];
  for(const[text,userId]of entries){f.at(1000);if(userId==='opted')f.conversation.privacy(createHash('sha256').update(userId).digest('hex'),'optout');f.receive({text,userId});}
  assert.equal(f.streamJokes.buffer.length,0);
  f.at(2000);f.receive({text:'Hi @someone, tasty snacks',userId:'safe'});f.at(600000);await f.generate();
  const text=f.calls[0].request.input[0].content[0].text;assert.doesNotMatch(text,/sk-secret|diagnosed|@someone|mock-secret/);assert.match(text,/tasty snacks/);
});

test('missing credentials, offline streams and failed images skip paid generation without fabricated jokes',async t=>{
  for(const mode of ['missing','stream_offline','frame_unavailable','twitch_auth_failed']){
    const f=fixture(t);if(mode==='missing')f.frame.configured=false;else f.frame.capture=async()=>{throw new Error(mode);};f.at(600000);
    assert.equal(await f.streamJokes.tick(),false);assert.equal(f.calls.length,0);assert.equal(f.store.state.records.length,0);
    assert.equal(f.streamJokes.snapshot().status,mode==='missing'?'twitch_credentials_missing':mode);
  }
});

test('shared hourly/day limits and lease prevent extra OpenAI calls',async t=>{
  for(const mode of ['hourly','budget','busy']){
    const f=fixture(t);f.at(600000);let release;
    if(mode==='hourly')for(let i=0;i<20;i++)f.store.reserve({id:'used-'+i,timestamp:700000,model:f.config?.model||'gpt-6-luna',purpose:'analysis',inputTokens:1,outputTokens:1,estimatedCost:.00001,reservedCost:0,status:'success'});
    if(mode==='budget')f.store.settings({...f.store.state.settings,dailyBudget:0});
    if(mode==='busy')release=acquireAILease(f.store);
    if(mode==='hourly'){assert.equal(await f.streamJokes.tick(),false);assert.equal(f.captures.length,0);assert.equal(f.streamJokes.status,'hourly_limit');}
    else{await f.streamJokes.tick();assert.equal(await f.conversation.tick(),false);assert.equal(f.streamJokes.status,mode==='budget'?'budget_limit':'ai_busy');}
    release?.();assert.equal(f.calls.length,0);
  }
});
test('zero hourly cap allows both visual capture and conversation-provider inference after twenty shared calls',async t=>{
  const f=fixture(t,{OPENAI_MAX_CALLS_PER_HOUR:'0'});f.at(600000);
  for(let i=0;i<20;i++)f.store.reserve({id:'prior-'+i,timestamp:700000,model:'gpt-6-luna',purpose:'analysis',inputTokens:1,outputTokens:1,estimatedCost:.00001,reservedCost:0,status:'success'});
  assert.equal(await f.generate(),true);assert.equal(f.calls.length,1);assert.equal(f.captures.length,1);assert.equal(f.store.state.records.length,21);
  f.store.settings({...f.store.state.settings,dailyBudget:0});f.at(1200000);assert.equal(await f.streamJokes.tick(),true);assert.equal(await f.conversation.tick(),false);assert.equal(f.streamJokes.status,'budget_limit');assert.equal(f.calls.length,1);
});
test('daily budget OFF permits visual jokes beyond the stored budget without losing usage records',async t=>{
  const f=fixture(t,{OPENAI_MAX_CALLS_PER_HOUR:'0',OPENAI_DAILY_BUDGET_ENABLED:'false'});f.at(600000);
  f.store.reserve({id:'spent',timestamp:700000,model:'gpt-6-luna',purpose:'analysis',inputTokens:1,outputTokens:1,estimatedCost:.5,reservedCost:0,status:'success'});
  assert.equal(await f.generate(),true);assert.equal(f.calls.length,1);assert.equal(f.streamJokes.status,'spoken');assert.ok(f.store.totals(700000).dailySpent>.5);
  f.conversation.updateSettings({liveAIEnabled:false});f.streamJokes.reset();f.at(1200000);assert.equal(await f.streamJokes.tick(),false);assert.equal(f.calls.length,1);
});

test('disabling, disconnecting or forgetting during image capture discards the complete pending context',async t=>{
  for(const mode of ['off','disconnect','forget']){
    const f=fixture(t);let resolve;f.frame.capture=()=>new Promise(r=>resolve=r);f.at(1000);f.receive({text:'Safe snacks',userId:'viewer'});f.at(600000);
    const job=f.streamJokes.tick();assert.equal(f.streamJokes.inFlight,true);
    if(mode==='off'){f.conversation.updateSettings({streamJokesEnabled:false});f.streamJokes.reset();}
    if(mode==='disconnect')f.streamJokes.setConnected(false);
    if(mode==='forget'){f.at(601000);f.receive({text:'!nib forget',userId:'viewer'});}
    resolve({dataURL:image,fetchedAt:700000,maxAgeSeconds:300});assert.equal(await job,false);assert.equal(f.streamJokes.buffer.length,0);assert.equal(f.conversation.queue.filter(c=>c.kind==='stream_joke').length,0);assert.equal(f.calls.length,0);
  }
});

test('feature off and demo mode never fetch a screenshot or call OpenAI',async t=>{
  for(const mode of ['off','demo']){const f=fixture(t,mode==='demo'?{DEMO_MODE:'true'}:{});if(mode==='off')f.conversation.updateSettings({streamJokesEnabled:false});f.at(600000);assert.equal(await f.streamJokes.tick(),false);assert.equal(f.captures.length,0);assert.equal(f.calls.length,0);}
});

test('active poll and existing speech are not interrupted by scheduled jokes; expired jobs are dropped',async t=>{
  const f=fixture(t);f.at(600000);await f.streamJokes.tick();
  f.conversation.openEvent({kind:'choice',question:'Which snack?',options:['A','B']},'poll');assert.equal(await f.conversation.tick(),false);assert.equal(f.calls.length,0);
  f.at(631000);f.conversation.prune();assert.equal(f.conversation.queue.length,0);assert.equal(f.streamJokes.status,'expired');
});

test('invalid or unsafe visual jokes are never published but usage remains charged',async t=>{
  for(const mode of ['wrong_id','unsafe','incomplete','missing_usage','followup']){
    const f=fixture(t),generate=f.client.responses.create;
    f.client.responses.create=async(...args)=>{const r=await generate(...args),out=JSON.parse(r.output_text);if(mode==='wrong_id')out.candidate_id='wrong';if(mode==='unsafe')out.reply='my address is secret';if(mode==='followup')out.followup={kind:'open',question:'Why?',options:[]};if(mode==='incomplete')r.status='incomplete';if(mode==='missing_usage')delete r.usage;r.output_text=JSON.stringify(out);return r;};
    f.at(600000);assert.equal(await f.generate(),false);assert.equal(f.conversation.speech,null);assert.equal(f.store.state.records.length,1);assert.ok(f.store.totals(700000).dailySpent>0);
  }
});

function twitchFixture() {
  let now=100000,tokenCalls=0,streamCalls=0;const calls=[];
  const handler=async(url,options)=>{
    const href=String(url);calls.push({url:href,options});
    if(href.includes('/oauth2/token')){tokenCalls++;return Response.json({access_token:'private-token-'+tokenCalls,expires_in:3600});}
    if(href.includes('/helix/streams')){streamCalls++;return Response.json({data:[{user_login:'uttie_pp',type:'live',thumbnail_url:'https://static-cdn.jtvnw.net/previews-ttv/live_user_uttie_pp-{width}x{height}.jpg'}]});}
    return new Response(Buffer.from([255,216,255,217]),{headers:{'content-type':'image/jpeg'}});
  };
  const f={handler};const frame=new TwitchFrame({config:config(),now:()=>now,fetch:(...args)=>f.handler(...args)});
  return{frame,calls,f,advance(ms){now+=ms;},get tokenCalls(){return tokenCalls;},get streamCalls(){return streamCalls;}};
}

test('Twitch uses client credentials, cached server token and bounded CDN image data',async()=>{
  const f=twitchFixture(),signal=new AbortController().signal,result=await f.frame.capture(signal);
  assert.match(result.dataURL,/^data:image\/jpeg;base64,/);assert.equal(result.maxAgeSeconds,300);assert.equal(result.width,512);
  const auth=f.calls[0];assert.equal(auth.options.method,'POST');assert.equal(auth.options.body.get('grant_type'),'client_credentials');assert.equal(auth.options.body.get('client_secret'),'mock-secret');assert.doesNotMatch(auth.url,/mock-secret/);
  assert.match(f.calls[1].url,/user_login=uttie_pp/);assert.equal(f.calls[1].options.headers.Authorization,'Bearer private-token-1');assert.match(f.calls[2].url,/512x288/);assert.equal(f.calls[2].options.headers,undefined);
  await f.frame.capture(signal);assert.equal(f.tokenCalls,1);f.advance(3600000);await f.frame.capture(signal);assert.equal(f.tokenCalls,2);
});

test('expired/revoked Twitch token is replaced once after Helix 401, without exposing it to CDN',async()=>{
  const f=twitchFixture(),original=f.f.handler;let first=true;
  f.f.handler=async(url,options)=>{if(String(url).includes('/helix/')&&first){first=false;return new Response('',{status:401});}return original(url,options);};
  await f.frame.capture(new AbortController().signal);assert.equal(f.tokenCalls,2);assert.equal(f.calls.at(-1).options.headers,undefined);
});

test('Twitch offline or non-CDN/redirect candidates never trigger arbitrary image downloads',async()=>{
  for(const candidate of [null,'http://127.0.0.1/private','https://attacker.example/a.jpg','https://static-cdn.jtvnw.net@attacker.example/a.jpg']){
    const f=twitchFixture(),original=f.f.handler;let imageCalls=0;
    f.f.handler=async(url,options)=>{if(String(url).includes('/helix/'))return Response.json({data:candidate?[{user_login:'uttie_pp',type:'live',thumbnail_url:candidate}]:[]});if(!String(url).includes('/oauth2/'))imageCalls++;return original(url,options);};
    await assert.rejects(f.frame.capture(new AbortController().signal),new RegExp(candidate?'invalid_frame_url':'stream_offline'));assert.equal(imageCalls,0);
  }
});

test('oversize or non-image Twitch CDN responses fail before OpenAI',async()=>{
  for(const mode of ['length','streamed','mime','magic']){
    const f=twitchFixture(),original=f.f.handler;
    f.f.handler=async(url,options)=>{if(!String(url).includes('/previews-ttv/'))return original(url,options);
      return new Response(mode==='streamed'?Buffer.alloc(524289):Buffer.from('not an image'),{headers:{'content-type':mode==='mime'?'text/html':'image/jpeg',...(mode==='length'?{'content-length':'999999'}:{})}});};
    await assert.rejects(f.frame.capture(new AbortController().signal),/frame_too_large|invalid_frame/);
  }
});
