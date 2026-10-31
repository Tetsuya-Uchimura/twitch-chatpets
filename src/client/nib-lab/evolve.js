import{mountStage}from'../stage.js';import{NIB_FORMS}from'../../shared/nib-forms.js';
const from=document.getElementById('from'),to=document.getElementById('to'),canvas=document.getElementById('world');
for(const[id,form]of Object.entries(NIB_FORMS)){from.add(new Option(form.name,id));to.add(new Option(form.name,id));}
from.value='base';to.value='blaze';let stage=null,generation=0;
function replay(){
 stage?.destroy();document.getElementById('pause').textContent='Pause';
 stage=mountStage(canvas,{overlay:true,playOnly:true,initialForm:from.value,onStatus:status=>{
  document.getElementById('status').textContent=status.transforming?`${NIB_FORMS[from.value].name} → ${NIB_FORMS[to.value].name}`:`${NIB_FORMS[status.form].name} · ${from.value===to.value?'Same form':'Evolution complete'}`;
  document.querySelectorAll('[data-phase]').forEach(span=>span.classList.toggle('current',span.dataset.phase===status.evolutionPhase));
 }});
 const now=Date.now();stage.update({sessionId:`evolution-preview-${++generation}`,serverTime:now,demo:false,stageSettings:{tempo:112,scale:1.6,anchor:'center',ambient:false,emotes:false},game:{startedAt:now,creatures:[{type:'cozy'}]},evolution:{form:to.value}});
}
document.getElementById('replay').onclick=replay;
document.getElementById('pause').onclick=event=>event.currentTarget.textContent=stage.togglePause()?'Play':'Pause';
replay();
