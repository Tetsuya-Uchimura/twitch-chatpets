// @ts-check
export const EVOLUTION_DURATION=3200;
const clamp=(/** @type {number} */n)=>Math.max(0,Math.min(1,n));
/** One transformation at a time; incoming targets coalesce without restarting the animation. */
export class EvolutionSequence{
 constructor(form='base'){this.form=form;this.target=form;/** @type {{from:string,to:string,start:number,duration:number}|null} */this.active=null;this.completed=0;}
 request(/** @type {string} */form){this.target=form;}
 get holding(){return this.active!==null||this.target!==this.form;}
 /** @param {number} now @param {boolean} blocked @param {boolean} reduced */
 tick(now,blocked,reduced=false){
  if(this.active&&now-this.active.start>=this.active.duration){this.form=this.active.to;this.active=null;this.completed++;return this.snapshot(now);}
  if(!this.active&&!blocked&&this.target!==this.form)this.active={from:this.form,to:this.target,start:now,duration:reduced?2000:EVOLUTION_DURATION};
  if(this.active&&this.progress(now)>=2150/EVOLUTION_DURATION)this.form=this.active.to;
  return this.snapshot(now);
 }
 progress(/** @type {number} */now){return this.active?clamp((now-this.active.start)/this.active.duration):1;}
 snapshot(/** @type {number} */now){
  const a=this.active,p=this.progress(now),t=p*EVOLUTION_DURATION;
  const phase=!a?'idle':t<650?'anticipate':t<1400?'charge':t<2150?'morph':t<2650?'reveal':'land';
  const local=phase==='anticipate'?t/650:phase==='charge'?(t-650)/750:phase==='morph'?(t-1400)/750:phase==='reveal'?(t-2150)/500:phase==='land'?(t-2650)/550:1;
  return{active:Boolean(a),form:this.form,from:a?.from||this.form,to:a?.to||this.form,target:this.target,pending:this.target!==this.form,phase,progress:p,local:clamp(local),elapsed:a?Math.max(0,now-a.start):0,duration:a?.duration||0,completed:this.completed};
 }
}
