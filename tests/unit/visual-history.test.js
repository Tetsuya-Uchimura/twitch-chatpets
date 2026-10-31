import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {ResponseLog} from '../../src/server/response-log.js';
import {needsScreenContext} from '../../src/server/visual-question.js';
import {createApp} from '../../src/server/app.js';
import {loadConfig} from '../../src/server/config.js';

const dataURL='data:image/jpeg;base64,/9j/2Q==';
function directory(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nib-visual-history-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
const row=(id,at)=>({id,at,text:'A short reply.',source:'What round is this?',kind:'direct',form:'base',animation:'curious',provider:'ai'});
function fixture(t){
  const dir=directory(t);let clock=100000,requests=[],captures=[];
  const frame={configured:true,async capture(signal,size){captures.push({signal,size});return{dataURL,fetchedAt:clock,maxAgeSeconds:300};}};
  const client={responses:{async create(request,options){requests.push({request,options});const content=request.input[0].content,p=JSON.parse(Array.isArray(content)?content[0].text:content);
    return{status:'completed',usage:{input_tokens:500,output_tokens:35},output_text:JSON.stringify({should_reply:true,candidate_id:p.candidate.id,reply:p.visual_context?.status==='available'?'The preview shows a final, but it may be behind live.':'I cannot get the preview. Which obstacle do you mean?',animation:'curious',evidence_ids:p.evidence.slice(-1).map(e=>e.id),followup:null})};}}};
  const config=loadConfig({DEMO_MODE:'false',OPENAI_API_KEY:'mock-key',OPENAI_MAX_CALLS_PER_HOUR:'0',OPENAI_DAILY_BUDGET_ENABLED:'false'});
  const runtime=createApp({directory:dir,config,now:()=>clock,streamFrame:frame,clientFactory:async()=>client,schedule:()=>1,unschedule(){}});
  runtime.conversation.updateSettings({liveAIEnabled:true});runtime.conversation.setConnected(true);
  t.after(()=>runtime.stop());
  return{...runtime,dir,frame,client,requests,captures,now:()=>clock,advance(ms=20000){clock+=ms;}};
}

test('visual routing recognizes current-screen questions in English/Japanese without fetching for ordinary praise',()=>{
  for(const text of ['what round is this','wait are they in finals??','how does that mechanic work exactly','what is this?','what game is this?','what are they playing?','who is winning?','Nib, check the screen','今何ラウンド？','今何のゲームしてる？','このギミックは何？','画面を見て'])assert.equal(needsScreenContext(text),true,text);
  for(const text of ['nice round','the costume looks nice','Nib, how are you today?','what snacks do you like?','what game do you like?','PogChamp','this game is funny'])assert.equal(needsScreenContext(text),false,text);
});

test('visual questions attach a bounded high-detail image to one paid request and retain only safe metadata',async t=>{
  const f=fixture(t);assert.equal(f.receive({text:'what round is this',userId:'viewer-one'}),true);assert.equal(f.conversation.queue.length,1);
  assert.equal(await f.conversation.tick(),true);assert.equal(f.requests.length,1);assert.equal(f.captures.length,1);assert.deepEqual(f.captures[0].size,{width:1280,height:720});
  const content=f.requests[0].request.input[0].content,p=JSON.parse(content[0].text);assert.equal(content[1].type,'input_image');assert.equal(content[1].detail,'high');assert.equal(content[1].image_url,dataURL);
  assert.equal(p.visual_context.status,'available');assert.equal(p.visual_context.maxAgeSeconds,300);assert.equal(p.image,undefined);assert.equal(f.store.state.records[0].purpose,'reaction');
  assert.match(f.requests[0].request.instructions,/behind live/);assert.equal(f.requests[0].options.maxRetries,0);
  assert.equal(f.conversation.logs[0].kind,'topic');assert.equal(f.conversation.logs[0].visual.status,'available');
  const saved=fs.readFileSync(path.join(f.dir,'conversation-log.json'),'utf8');assert.doesNotMatch(saved,/data:image|mock-key|viewer-one|profile|participant/);
  assert.doesNotMatch(JSON.stringify(f.snapshot()),/data:image|mock-key/);
});

test('ordinary praise never captures; visual questions reuse a preview for at most thirty seconds',async t=>{
  const f=fixture(t);f.receive({text:'Nib, the costume looks nice',userId:'one'});assert.equal(await f.conversation.tick(),true);assert.equal(f.captures.length,0);
  f.advance();f.receive({text:'what round is this?',userId:'two'});await f.conversation.tick();assert.equal(f.captures.length,1);
  f.advance();f.receive({text:'is this the final round?',userId:'three'});await f.conversation.tick();assert.equal(f.captures.length,1);
  const last=f.requests.at(-1).request.input[0].content;assert.equal(JSON.parse(last[0].text).visual_context.maxAgeSeconds,320);
  f.advance();f.receive({text:'which map is this?',userId:'four'});await f.conversation.tick();assert.equal(f.captures.length,2);
});

test('offline or missing Twitch credentials fall back to one text-only reply and record the reason',async t=>{
  for(const mode of ['stream_offline','twitch_credentials_missing']){
    const f=fixture(t);if(mode==='twitch_credentials_missing')f.frame.configured=false;else f.frame.capture=async()=>{throw new Error(mode);};
    f.receive({text:'what round is this?',userId:'one'});assert.equal(await f.conversation.tick(),true);
    const content=f.requests[0].request.input[0].content;assert.equal(typeof content,'string');assert.equal(JSON.parse(content).visual_context.status,mode);assert.equal(f.requests.length,1);assert.equal(f.conversation.logs[0].visual.status,mode);
  }
});

test('disconnect/forget/disable during image fetch prevents a late API request or cached image',async t=>{
  for(const mode of ['disconnect','forget','disable']){
    const f=fixture(t);let resolve;f.frame.capture=()=>new Promise(r=>resolve=r);f.receive({text:'what round is this?',userId:'one'});const work=f.conversation.tick();
    if(mode==='disconnect')f.conversation.setConnected(false);
    if(mode==='forget'){f.advance(1000);f.receive({text:'!nib forget',userId:'one'});}
    if(mode==='disable')f.conversation.updateSettings({enabled:false});
    resolve({dataURL,fetchedAt:f.now(),maxAgeSeconds:300});assert.equal(await work,false);assert.equal(f.requests.length,0);assert.equal(f.conversation.frameCache,null);
  }
});

test('demo and opted-out viewers cannot trigger screenshot retrieval',async t=>{
  const f=fixture(t);f.receive({text:'!nib optout',userId:'one'});f.advance(1000);f.receive({text:'what round is this?',userId:'one'});assert.equal(await f.conversation.tick(),false);assert.equal(f.captures.length,0);
  const demo=createApp({directory:directory(t),config:loadConfig({DEMO_MODE:'true'}),streamFrame:{configured:true,capture(){assert.fail('Demo captured Twitch');}}});t.after(()=>demo.stop());
  demo.receive({text:'Nib, what round is this?',userId:'demo'});assert.equal(await demo.conversation.tick(),true);
});

test('review history retains more than twenty entries for six hours across restart, with a hard bound and identity stripping',t=>{
  const dir=directory(t);let clock=100000;const log=new ResponseLog({directory:dir,now:()=>clock});
  for(let i=0;i<30;i++)log.append({...row('reply-'+i,clock+i),profile:'do-not-store',image:dataURL});clock+=100;
  assert.equal(log.snapshot().totalEntries,30);assert.equal(log.snapshot().entries.length,20);assert.equal(new ResponseLog({directory:dir,now:()=>clock}).snapshot(5000).entries.length,30);
  assert.doesNotMatch(fs.readFileSync(log.file,'utf8'),/do-not-store|data:image|profile/);
  clock=100000+6*3600000+20;log.prune();assert.equal(log.entries.length,9);
  log.entries=Array.from({length:5001},(_,i)=>row('bounded-'+i,clock));log.prune();assert.equal(log.entries.length,5000);
});

test('six-hour review logs survive disconnect but are not used as old-session AI memory; privacy deletion clears disk',async t=>{
  const f=fixture(t);f.receive({text:'Nib, how are you today?',userId:'one'});await f.conversation.tick();assert.equal(f.conversation.logs.length,1);
  f.conversation.setConnected(false);assert.equal(f.conversation.memory.length,0);assert.equal(f.conversation.logs.length,1);assert.deepEqual(f.conversation.payload({id:'x',text:'new'},'base').recent_nib_lines,[]);
  const reopened=new ResponseLog({directory:f.dir,now:f.now});assert.equal(reopened.entries.length,1);
  f.conversation.deleteViewer('one');assert.equal(f.conversation.logs.length,0);assert.equal(new ResponseLog({directory:f.dir,now:f.now}).entries.length,0);
});

test('corrupt log files are preserved and storage failure is visible without disabling conversation',t=>{
  const dir=directory(t),file=path.join(dir,'conversation-log.json');fs.writeFileSync(file,'broken');const log=new ResponseLog({directory:dir});
  assert.equal(log.storageFailed,true);log.append(row('x',Date.now()));assert.equal(fs.readFileSync(file,'utf8'),'broken');assert.equal(log.snapshot().storageFailed,true);
});

test('full history endpoint is local-only, bounded on demand, while normal state stays at twenty entries',async t=>{
  const f=fixture(t);for(let i=0;i<30;i++)f.conversation.responseLog.append(row('row-'+i,f.now()));
  const server=f.app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}`;
  const full=await fetch(base+'/api/conversation/logs').then(r=>r.json());assert.equal(full.entries.length,30);assert.equal(full.retentionHours,6);
  assert.equal((await fetch(base+'/api/conversation/logs?limit=5').then(r=>r.json())).entries.length,5);
  assert.equal((await fetch(base+'/api/conversation/logs?limit=5001')).status,400);assert.equal((await fetch(base+'/api/conversation/logs',{headers:{Origin:'https://invalid.example'}})).status,403);
  assert.equal(f.snapshot().conversation.logs.length,20);assert.equal(f.snapshot().conversation.logHistory.totalEntries,30);
});
