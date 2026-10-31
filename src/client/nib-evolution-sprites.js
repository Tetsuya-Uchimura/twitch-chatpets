import {generateSprite,FRAME_COUNTS,SPRITE_STATES}from'./mascot-sprites.js';
export {FRAME_COUNTS,SPRITE_STATES};
export const SPRITE_WIDTH=64,SPRITE_HEIGHT=56,SPRITE_GROUND=52;
const specs={base:[12,18,40,36],bloom:[11,23,45,30],giggle:[14,14,38,39],blaze:[14,18,38,35],bulwark:[8,14,48,39],astral:[16,20,35,32]};
const palettes={
 bloom:['#182f32','#84bb77','#4c8865','#cce8a1','#fffce8','#182f32','#548f62','#e8ef9d','#e8a091'],
 giggle:['#392e3d','#f0d589','#c69c68','#fff0b4','#fffce8','#392e3d','#e399a8','#fce2b0','#db7776'],
 blaze:['#392f35','#efb175','#bf735b','#ffe3a1','#fffce8','#392f35','#e8794f','#fff0ac','#db7776'],
 bulwark:['#283239','#91a9a0','#5b7475','#c0d1ba','#fffce8','#283239','#9d747a','#d8bbab','#db7776'],
 astral:['#2a2c46','#b3a3d8','#79789f','#ded8ef','#fffce8','#2a2c46','#96bddd','#eae5b0','#db7776'],
};
/** Original editable pixel shapes; all forms retain Nib's eyes, muzzle, forked ears and feet. */
export function generateEvolvedNib(state='idle',frame=0,form='base',emotion='calm',gesture={}){
 if(!specs[form])form='base';if(!SPRITE_STATES.includes(state))state='idle';frame=Math.abs(Math.floor(frame))%FRAME_COUNTS[state];
 const original=generateSprite(state,frame,'cozy',emotion,gesture),pixels=new Uint8Array(SPRITE_WIDTH*SPRITE_HEIGHT);
 const put=(x,y,c)=>{x=Math.round(x);y=Math.round(y);if(x>=0&&x<64&&y>=0&&y<56)pixels[y*64+x]=c;};
 const rect=(x,y,w,h,c)=>{for(let yy=Math.round(y);yy<y+h;yy++)for(let xx=Math.round(x);xx<x+w;xx++)put(xx,yy,c);};
 const line=(x0,y0,x1,y1,c,w=1)=>{const n=Math.max(Math.abs(x1-x0),Math.abs(y1-y0),1);for(let i=0;i<=n;i++)rect(x0+(x1-x0)*i/n,y0+(y1-y0)*i/n,w,w,c);};
 const ellipse=(cx,cy,rx,ry,c)=>{for(let y=cy-ry;y<=cy+ry;y++)for(let x=cx-rx;x<=cx+rx;x++)if(((x-cx)/rx)**2+((y-cy)/ry)**2<=1)put(x,y,c);};
 const polygon=(points,c)=>{const ys=points.map(p=>p[1]),xs=points.map(p=>p[0]);for(let y=Math.min(...ys);y<=Math.max(...ys);y++)for(let x=Math.min(...xs);x<=Math.max(...xs);x++){let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;}if(inside)put(x,y,c);}};
 const plate=(x,y,w,h)=>{rect(x,y,w,h,1);rect(x+1,y+1,w-2,h-2,7);rect(x+2,y+2,w-4,2,8);};
 const sleeping=state==='sleep',beat=frame%2?2:0,dy=sleeping?18:0;
 if(form==='bloom'){
  ellipse(23,36,18,15,3);ellipse(22,34,15,12,7);line(12,33,30,45,4,2);line(30,23,12,43,3,2);
  line(23,26,20,15+dy,7,3);polygon([[20,18+dy],[6,10+dy],[8,21+dy],[22,26+dy]],2);polygon([[21,19+dy],[31,9+dy+beat],[36,18+dy],[23,26+dy]],4);
 }else if(form==='giggle'){
  polygon([[23,23+dy],[20,3+dy+beat],[26,1+dy+beat],[32,25+dy]],7);polygon([[43,24+dy],[47,5+dy-beat],[54,9+dy],[48,29+dy]],7);
  line(25,6+dy+beat,28,19+dy,8,2);line(49,11+dy,46,22+dy,8,2);
  if(!sleeping){ellipse(22,49,7,3,7);ellipse(46,49,7,3,7);}
 }else if(form==='blaze'){
  if(!sleeping){
   polygon([[26,32],[12,17-beat],[1,28-beat],[11,28],[3,41],[24,44]],7);
   polygon([[44,31],[56,17+beat],[63,26],[56,31],[63,41],[43,44]],7);
   line(9,28-beat,23,38,8,2);line(55,29+beat,46,39,8,2);
  }else{polygon([[15,42],[5,35],[8,49],[26,49]],7);polygon([[43,43],[57,36],[53,49],[41,49]],7);}
  polygon([[24,24+dy],[26,9+dy],[31,17+dy],[35,5+dy+beat],[39,17+dy],[44,12+dy],[44,28+dy]],7);
  polygon([[3,40],[1,29-beat],[7,32],[12,23+beat],[15,39]],8);
 }else if(form==='bulwark'){
  plate(3,31+beat,17,15);plate(46,31-beat,16,16);plate(13,47,16,6);plate(38,47,17,6);
  polygon([[24,25+dy],[24,12+dy],[29,7+dy],[30,24+dy]],8);polygon([[49,25+dy],[60,12+dy],[57,29+dy]],8);
  line(6,36+beat,16,36+beat,3,2);line(49,37-beat,59,37-beat,3,2);
 }else if(form==='astral'){
  ellipse(10,38,9,10,7);ellipse(10,37,5,6,0);line(7,40,15,43,8,2);
  line(31,25+dy,29,9+dy+beat,7,2);polygon([[29,2+dy+beat],[34,8+dy+beat],[29,13+dy+beat],[24,8+dy+beat]],8);
  line(44,25+dy,51,14+dy-beat,7,2);ellipse(52,12+dy-beat,4,4,4);
  if(!sleeping){rect(3+beat,22,3,3,8);rect(58-beat,39,3,3,8);}
 }
 const [ox,oy,w,h]=specs[form];
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const c=original.pixels[Math.min(35,Math.floor(y*36/h))*40+Math.min(39,Math.floor(x*40/w))];
  const sway=form==='astral'&&!sleeping?Math.round(Math.sin(y/7+frame)*1.2):0;
  if(c)put(ox+x+sway,oy+y,c);
 }
 if(form==='bloom'&&!sleeping){line(11,32,17,38,4,2);line(17,28,27,41,3,2);}
 if(form==='giggle'&&!sleeping){rect(27,37,22,3,7);ellipse(40,42,3,3,8);put(40,44,1);}
 if(form==='bulwark'){plate(8,35,12,10);plate(49,36,12,10);if(!sleeping){rect(24,40,20,7,3);rect(26,41,16,2,7);}}
 if(form==='astral'&&!sleeping){polygon([[42,22],[46,18],[50,22],[46,27]],8);put(46,22,5);}
 // A one-pixel contour on the entire silhouette keeps added limbs and armor coherent.
 const copy=pixels.slice();for(let y=0;y<56;y++)for(let x=0;x<64;x++)if(copy[y*64+x]&&(!x||!y||x===63||y===55||!copy[y*64+x-1]||!copy[y*64+x+1]||!copy[(y-1)*64+x]||!copy[(y+1)*64+x]))pixels[y*64+x]=1;
 const palette=form==='base'?original.palette:['transparent',...palettes[form]];
 return{width:64,height:56,pixels,palette};
}
export function compileEvolvedNib(state,frame,form,emotion='calm',gesture={}){
 const sprite=generateEvolvedNib(state,frame,form,emotion,gesture),colors=new Map();
 for(let y=0;y<sprite.height;y++)for(let x=0;x<sprite.width;){const start=x,c=sprite.pixels[y*sprite.width+x++];while(x<sprite.width&&sprite.pixels[y*sprite.width+x]===c)x++;if(c){if(!colors.has(c))colors.set(c,[]);colors.get(c).push({x:start,y,width:x-start});}}
 return{width:sprite.width,height:sprite.height,palette:sprite.palette,colors};
}
