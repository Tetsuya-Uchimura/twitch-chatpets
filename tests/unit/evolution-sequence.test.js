import test from'node:test';import assert from'node:assert/strict';
import{EvolutionSequence,EVOLUTION_DURATION}from'../../src/client/evolution-sequence.js';
import{compileMorphSprite,evolutionPose}from'../../src/client/evolution-effects.js';
import{generateEvolvedNib}from'../../src/client/nib-evolution-sprites.js';import{NIB_FORMS}from'../../src/shared/nib-forms.js';import{StageDirector}from'../../src/client/stage-model.js';
test('old form remains through charging, five stages run once, and form commits after morphing',()=>{
 const s=new EvolutionSequence('bloom');s.request('blaze');assert.equal(s.tick(1000,true).active,false);assert.equal(s.holding,true);
 assert.equal(s.tick(2000,false).phase,'anticipate');
 for(const[t,phase,form]of[[600,'anticipate','bloom'],[700,'charge','bloom'],[1500,'morph','bloom'],[2200,'reveal','blaze'],[2800,'land','blaze']]){const p=s.tick(2000+t,false);assert.equal(p.phase,phase);assert.equal(p.form,form);}
 assert.equal(s.tick(2000+EVOLUTION_DURATION,false).active,false);assert.equal(s.form,'blaze');assert.equal(s.completed,1);s.tick(9000,false);assert.equal(s.completed,1);
});
test('repeated requests do not reset animation and the latest target coalesces',()=>{
 const s=new EvolutionSequence();s.request('bloom');s.tick(0,false);s.request('giggle');s.tick(800,false);s.request('bulwark');s.tick(1600,false);s.request('astral');s.tick(2000,false);
 assert.equal(s.active.start,0);assert.equal(s.active.to,'bloom');s.tick(3200,false);assert.equal(s.form,'bloom');s.tick(3201,false);assert.equal(s.active.to,'astral');s.tick(6401,false);assert.equal(s.completed,2);
});
test('hidden-tab gaps finish a single transition; reduced motion keeps all stages with no lift',()=>{
 const s=new EvolutionSequence();s.request('blaze');s.tick(0,false);assert.equal(s.tick(3600000,false).completed,1);assert.equal(s.form,'blaze');
 s.request('astral');assert.equal(s.tick(3600001,false,true).duration,2000);for(const ms of[100,500,1000,1500,1800])assert.equal(evolutionPose(s.tick(3600001+ms,false,true),true).lift,0);
});
test('all morph pairs retain visible CPU pixels and exact endpoint palettes',()=>{
 for(const from of Object.keys(NIB_FORMS))for(const to of Object.keys(NIB_FORMS)){
  const a=generateEvolvedNib('evolve',1,from),b=generateEvolvedNib('evolve',1,to);
  for(const p of[0,.25,.5,.75,1]){const mixed=compileMorphSprite(a,b,p,p);assert.ok(mixed.count>300);assert.ok([...mixed.colors.keys()].every(c=>mixed.palette[c]));}
  for(const[p,expected]of[[0,a],[1,b]]){const mixed=compileMorphSprite(a,b,p,1),actual=new Array(64*56).fill('transparent');for(const[c,spans]of mixed.colors)for(const v of spans)for(let x=v.x;x<v.x+v.width;x++)actual[v.y*64+x]=mixed.palette[c];assert.deepEqual(actual,[...expected.pixels].map(c=>expected.palette[c]));}
 }
});
test('a transformation barrier finishes the active action and retains queued chat without starting it',()=>{
 const d=new StageDirector();d.reset(1000);const settings={tempo:112,ambient:false};d.receive({sequence:1,text:'snack',performance:'eat'},1000,settings);d.receive({sequence:2,text:'jump',performance:'jump'},1100,settings);
 const held=d.tick(5000,{...settings,holdActions:true})[0];assert.equal(held.active,false);assert.equal(held.queue.length,1);d.receive({sequence:3,text:'hello',performance:'inspect'},5000,{...settings,holdActions:true});assert.equal(d.actors[0].queue.length,2);
 assert.equal(d.tick(5001,settings)[0].note.sequence,2);
});
