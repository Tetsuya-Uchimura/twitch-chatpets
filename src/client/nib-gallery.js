import{NIB_FORMS}from'../shared/nib-forms.js';
import{generateEvolvedNib,FRAME_COUNTS}from'./nib-evolution-sprites.js';
export function paintNib(ctx,form,action='idle',frame=0,unit=2){
 const emotion=NIB_FORMS[form].emotion||'calm',sprite=generateEvolvedNib(action,frame,form,emotion);
 ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);ctx.imageSmoothingEnabled=false;
 for(let y=0;y<56;y++)for(let x=0;x<64;x++){const c=sprite.pixels[y*64+x];if(c){ctx.fillStyle=sprite.palette[c];ctx.fillRect(x*unit,y*unit,unit,unit);}}
}
export function mountNibGallery(element,unit=2){
 for(const[form,info]of Object.entries(NIB_FORMS)){
  const card=document.createElement('article');card.className='evolution-card';card.dataset.evolutionCard=form;
  const canvas=document.createElement('canvas');canvas.width=64*unit;canvas.height=56*unit;canvas.setAttribute('aria-label',info.name);
  const title=document.createElement('h3');title.textContent=info.name;
  const description=document.createElement('p');description.textContent=info.detail;
  card.append(canvas,title,description);element.append(card);paintNib(canvas.getContext('2d'),form,'idle',0,unit);
 }
}
export {FRAME_COUNTS};
