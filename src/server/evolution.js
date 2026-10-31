import {EMOTION_FORM,NIB_FORMS}from'../shared/nib-forms.js';
/** One authoritative form decision per completed sentiment window. No network calls. */
export class NibEvolution{
 constructor(){this.form='base';this.emotion=null;this.revision=0;this.changedAt=null;this.key='';this.reason='collecting';this.history=[];}
 observe(summary){
  const key=`${summary.generation||0}:${summary.windowEnd}:${summary.analysisRevision||0}`;if(key===this.key)return false;this.key=key;
  if(summary.accepted!==undefined&&summary.accepted<(summary.minMessages??5)){
   this.reason='insufficient';this.emotion=null;if(this.form==='base')return false;
   const previous=this.form;this.form='base';this.revision++;this.changedAt=summary.windowEnd;
   this.history.push({from:previous,to:'base',at:this.changedAt,simulated:Boolean(summary.simulated)});this.history=this.history.slice(-8);return true;
  }
  if(summary.analysisMode==='ai'&&summary.analysisStatus!=='ready'){this.reason=summary.analysisStatus;return false;}
  const ranked=Object.entries(summary.fractions).sort((a,b)=>b[1]-a[1]);const [emotion,share]=ranked[0];
  const supported=summary.evolutionEligible??(!summary.insufficient&&summary.confidence>=.7&&share>=.4&&share-ranked[1][1]>=.12&&summary.emotion===emotion);
  if(!supported){this.reason=summary.insufficient?'insufficient':'mixed';return false;}
  this.reason='minute-sentiment';this.emotion=emotion;const next=EMOTION_FORM[emotion];if(next===this.form)return false;
  const previous=this.form;this.form=next;this.revision++;this.changedAt=summary.windowEnd;
  this.history.push({from:previous,to:next,at:this.changedAt,simulated:Boolean(summary.simulated)});this.history=this.history.slice(-8);return true;
 }
 snapshot(){return{form:this.form,name:NIB_FORMS[this.form].name,emotion:this.emotion,revision:this.revision,changedAt:this.changedAt,reason:this.reason,history:[...this.history],intervalSeconds:60};}
}
