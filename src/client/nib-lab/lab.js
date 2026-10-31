import{mountNibGallery,paintNib,FRAME_COUNTS}from'../nib-gallery.js';
import{NIB_FORMS}from'../../shared/nib-forms.js';
mountNibGallery(document.getElementById('forms'),3);
let paused=false,action='idle',elapsed=0,last=performance.now();
document.getElementById('pause').onclick=event=>{paused=!paused;event.currentTarget.textContent=paused?'Play':'Pause';};
document.getElementById('action').onchange=event=>{action=event.target.value;elapsed=0;};
document.getElementById('background').onchange=event=>document.body.dataset.bg=event.target.value;
function animate(now){requestAnimationFrame(animate);if(!paused)elapsed+=Math.min(100,now-last);last=now;
 for(const canvas of document.querySelectorAll('canvas')){const form=canvas.parentElement.dataset.evolutionCard;const frame=Math.floor(elapsed/(form==='bulwark'?230:form==='giggle'?130:form==='blaze'?120:220))%FRAME_COUNTS[action];paintNib(canvas.getContext('2d'),form,action,frame,3);canvas.dataset.form=form;canvas.dataset.action=action;canvas.dataset.frame=String(frame);}
 document.body.dataset.ready='true';}
requestAnimationFrame(animate);
export function exportFormSheet(){const c=document.createElement('canvas');c.width=192*3;c.height=190*2;const ctx=c.getContext('2d');let i=0;for(const[form,info]of Object.entries(NIB_FORMS)){const tile=document.createElement('canvas');tile.width=192;tile.height=168;paintNib(tile.getContext('2d'),form,'idle',0,3);ctx.drawImage(tile,(i%3)*192,Math.floor(i/3)*190);ctx.fillStyle='#a7ca90';ctx.font='12px sans-serif';ctx.fillText(info.name,(i%3)*192+8,Math.floor(i/3)*190+184);i++;}return c.toDataURL('image/png');}
