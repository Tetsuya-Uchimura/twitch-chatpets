import {NIB_FORMS} from '../shared/nib-forms.js';
const BAYER=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
/** CPU pixels always retain a solid silhouette; no canvas bitmap cache or alpha crossfade. */
export function compileMorphSprite(from,to,shapeProgress,colorProgress=0){
 const palette=['transparent','#fff8dc','#7c9464',...from.palette.slice(1),...to.palette.slice(1)],colors=new Map();
 const offset=from.palette.length+1,shape=Math.round(Math.max(0,Math.min(1,shapeProgress))*16),reveal=Math.round(Math.max(0,Math.min(1,colorProgress))*16);
 let count=0;
 for(let y=0;y<56;y++)for(let x=0;x<64;){
  const colorAt=xx=>{const rank=BAYER[(y%4)*4+xx%4],i=y*64+xx,next=rank<shape,c=next?to.pixels[i]:from.pixels[i];return c?(rank<reveal?(next?offset+c:c+2):c===1?2:1):0;};
  const start=x,c=colorAt(x++);while(x<64&&colorAt(x)===c)x++;
  if(c){count+=x-start;if(!colors.has(c))colors.set(c,[]);colors.get(c).push({x:start,y,width:x-start});}
 }
 return{width:64,height:56,palette,colors,count};
}
export function evolutionPose(scene,reduced=false){
 const p=scene.local,phase=scene.phase;
 return{action:phase==='anticipate'||phase==='land'?'jump':'evolve',frame:phase==='anticipate'?0:phase==='land'?2:Math.floor(scene.elapsed/120)%4,
  squat:phase==='anticipate'?Math.round(3*p):phase==='land'?Math.round(3*Math.sin(p*Math.PI)):0,
  arms:phase==='anticipate',lift:reduced?0:phase==='charge'?-Math.sin(p*Math.PI/2)*6:phase==='morph'?-6:phase==='reveal'?-6*(1-p):0,
  shape:phase==='morph'?p:phase==='reveal'||phase==='land'?1:0,
  color:phase==='anticipate'?1:phase==='charge'?1-Math.max(0,(p-.25)/.75):phase==='morph'?0:phase==='reveal'?p:1};
}
/** Localized pixel effects, bounded to the play area; the OBS background stays transparent. */
export function paintEvolutionEffects(ctx,scene,center,ground,zoom,reduced=false,front=false,captionCenter=center){
 if(!scene.active)return;
 const accent=NIB_FORMS[scene.to].color,p=scene.local,phase=scene.phase;
 const dot=(x,y,w,h,color,alpha=1)=>{ctx.globalAlpha=alpha;ctx.fillStyle=color;ctx.fillRect(Math.round(center+x*zoom),Math.round(ground+y*zoom),Math.max(1,Math.round(w*zoom)),Math.max(1,Math.round(h*zoom)));};
 const star=(x,y,size,color,alpha=1)=>{dot(x-size,y,2*size+2,2,color,alpha);dot(x,y-size,2,2*size+2,color,alpha);};
 const ring=(radius,ry,color,alpha)=>{for(let i=0;i<40;i++){const a=i*Math.PI/20;dot(Math.cos(a)*radius,-68+Math.sin(a)*ry,3,3,color,alpha);}};
 ctx.save();
 try{
  if(!front){
   if(!reduced){const strength=phase==='anticipate'?p*.35:phase==='charge'?.35+.65*p:phase==='morph'?1:Math.max(0,1-p);
    ring(42+strength*27,35+strength*28,accent,.25+strength*.35);
    ring(65-strength*18,55-strength*17,'#ffe4a0',strength*.45);
    if(['charge','morph','reveal'].includes(phase))for(let i=0;i<12;i++){const a=i*Math.PI/6,inner=phase==='charge'?95-45*p:38+34*p;const len=phase==='morph'?16:8;
     for(let j=0;j<len;j+=3)dot(Math.cos(a)*(inner+j),-68+Math.sin(a)*(inner+j)*.7,2,3,i%2?accent:'#ffe5a8',.2+.35*strength);}
   }else ring(55,43,accent,.25);
  }else{
   const count=reduced?6:28;
   if(phase!=='anticipate')for(let i=0;i<count;i++){
    const a=i*2.39996+(reduced?0:scene.elapsed/850),travel=phase==='charge'?92-(p*73+i*7)%73:phase==='morph'?40+Math.sin(i+scene.elapsed/310)*17:20+p*70;
    const alpha=phase==='land'?(1-p)*.7:.65;
    star(Math.cos(a)*travel,-65+Math.sin(a)*travel*.65,i%5===0?3:1,i%3?accent:'#fff0bc',alpha);
   }
   if(phase==='land'){
    const radius=18+74*p;for(let i=0;i<24;i++){const a=i*Math.PI/12;dot(Math.cos(a)*radius,4+Math.sin(a)*radius*.13,6,2,accent,(1-p)*.65);}
   }
   ctx.globalAlpha=1;ctx.textAlign='center';ctx.font=`700 ${Math.max(9,Math.round(11*zoom))}px 'Segoe UI','Meiryo',sans-serif`;
   const text=phase==='anticipate'?'Evolution is coming…':phase==='charge'?'Gathering power':phase==='morph'?'Changing shape…':`Evolved into ${NIB_FORMS[scene.to].name}!`;
   const metrics=ctx.measureText(text),w=Math.min(295*zoom,metrics.width+20*zoom),h=21*zoom;
   ctx.fillStyle='#18332de8';ctx.fillRect(Math.round(captionCenter-w/2),Math.round(ground+14*zoom),Math.round(w),Math.round(h));ctx.fillStyle=phase==='reveal'||phase==='land'?'#fff1b8':'#d6efc5';ctx.fillText(text,Math.round(captionCenter),Math.round(ground+28*zoom),w-8*zoom);
  }
 }finally{ctx.restore();}
}
