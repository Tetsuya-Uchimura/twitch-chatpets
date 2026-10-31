import test from'node:test';import assert from'node:assert/strict';
import{NibEvolution}from'../../src/server/evolution.js';import{ChatPulse}from'../../src/server/pulse.js';
import{NIB_FORMS,EMOTION_FORM}from'../../src/shared/nib-forms.js';import{generateEvolvedNib,compileEvolvedNib,SPRITE_STATES,FRAME_COUNTS}from'../../src/client/nib-evolution-sprites.js';
const texts={calm:'so cozy',laughter:'LOL www',excitement:'HYPE 🔥',anger:'this sucks',confusion:'what happened?'};
test('Nib remains ordinary until a full minute, then follows five supported emotions exactly once per window',()=>{
 let now=100000,sequence=0;const pulse=new ChatPulse({},()=>now),evolution=new NibEvolution();
 assert.equal(evolution.snapshot().form,'base');evolution.observe(pulse.snapshot());
 for(const[emotion,text]of Object.entries(texts)){
  const before=evolution.revision;
  for(let i=0;i<8;i++){now+=1000;pulse.ingest({at:now,sequence:++sequence,text,participant:'u'+i});evolution.observe(pulse.snapshot());}
  assert.equal(evolution.revision,before,'individual comments must not change form');now+=52000;
  assert.equal(evolution.observe(pulse.snapshot()),true);assert.equal(evolution.form,EMOTION_FORM[emotion]);assert.equal(evolution.revision,before+1);
  assert.equal(evolution.observe(pulse.snapshot()),false);assert.equal(evolution.revision,before+1);
 }
 now+=60000;evolution.observe(pulse.snapshot());assert.equal(evolution.form,'base');assert.equal(evolution.reason,'insufficient');
});
test('mixed or low-evidence summaries never invent a new evolution; activity volume is not a sixth emotion',()=>{
 const e=new NibEvolution(),base={windowEnd:1,generation:0,fractions:{calm:.5,laughter:.5,excitement:0,anger:0,confusion:0},emotion:'calm',confidence:.95,insufficient:false};
 assert.equal(e.observe(base),false);assert.equal(e.form,'base');
 assert.equal(e.observe({...base,windowEnd:2,fractions:{calm:1,laughter:0,excitement:0,anger:0,confusion:0}}),true);assert.equal(e.form,'bloom');
 assert.equal(e.observe({...base,windowEnd:3,accepted:10000,insufficient:true}),false);assert.equal(e.form,'bloom');
 assert.equal(e.observe({...base,generation:1,windowEnd:2,fractions:{calm:0,laughter:0,excitement:1,anger:0,confusion:0},emotion:'excitement',simulated:true}),true);assert.equal(e.form,'blaze');
});
test('six forms change body silhouette substantially, not only palette and facial pixels',()=>{
 const base=generateEvolvedNib('idle',0,'base');const signatures=new Set();
 for(const form of Object.keys(NIB_FORMS)){
  const sprite=generateEvolvedNib('idle',0,form);signatures.add(sprite.pixels.map(p=>p?1:0).join(''));
  if(form!=='base'){let changed=0;for(let i=0;i<sprite.pixels.length;i++)if(Boolean(sprite.pixels[i])!==Boolean(base.pixels[i]))changed++;assert.ok(changed>250,`${form} needs a distinct silhouette: ${changed}`);}
 }
 assert.equal(signatures.size,6);
});
test('every form supports all actions and compiles into exact CPU pixel spans without image caches',()=>{
 for(const form of Object.keys(NIB_FORMS))for(const action of SPRITE_STATES)for(let frame=0;frame<FRAME_COUNTS[action];frame++){
  const sprite=generateEvolvedNib(action,frame,form),compiled=compileEvolvedNib(action,frame,form),actual=new Uint8Array(64*56);
  for(const[color,spans]of compiled.colors)for(const s of spans)for(let x=s.x;x<s.x+s.width;x++)actual[s.y*64+x]=color;
  assert.deepEqual(actual,sprite.pixels);assert.ok(actual.reduce((n,p)=>n+Number(p>0),0)>300);assert.ok(actual.every(p=>p<sprite.palette.length));
 }
});
