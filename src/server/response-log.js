import fs from 'node:fs';
import path from 'node:path';
import {z} from 'zod';

export const RESPONSE_LOG_HOURS = 6;
export const RESPONSE_LOG_LIMIT = 5000;
const visual = z.object({status:z.string().max(40),fetchedAt:z.number().nullable().optional(),maxAgeSeconds:z.number().nullable().optional()}).strip();
const row = z.object({id:z.string().min(1).max(100),at:z.number().finite(),text:z.string().max(140),
  animation:z.string().max(32),form:z.string().max(32),provider:z.enum(['ai','demo','local']),
  source:z.string().max(240).default(''),kind:z.string().max(40).default('unknown'),visual:visual.optional()}).strip();
const schema=z.object({version:z.literal(1),records:z.array(row).max(RESPONSE_LOG_LIMIT)}).strict();

/** Local review history, independent of short-term model memory. No identities or images. */
export class ResponseLog {
  constructor({directory,now=Date.now}) {
    this.file=path.join(directory,'conversation-log.json');this.now=now;this.entries=[];this.storageFailed=false;
    try {
      fs.mkdirSync(directory,{recursive:true});
      if(fs.existsSync(this.file))this.entries=schema.parse(JSON.parse(fs.readFileSync(this.file,'utf8'))).records;
      this.prune();
      if(!fs.existsSync(this.file))this.save();
    }catch{this.storageFailed=true;}
  }
  save() {
    if(this.storageFailed)return false;
    try{const data=schema.parse({version:1,records:this.entries}),tmp=this.file+'.tmp';
      fs.writeFileSync(tmp,JSON.stringify(data),{mode:0o600});fs.renameSync(tmp,this.file);return true;
    }catch{this.storageFailed=true;return false;}
  }
  prune() {
    const cutoff=this.now()-RESPONSE_LOG_HOURS*3600000;
    const next=this.entries.filter(e=>e.at>cutoff&&e.at<=this.now()+60000).sort((a,b)=>b.at-a.at).slice(0,RESPONSE_LOG_LIMIT);
    if(next.length!==this.entries.length){this.entries=next;this.save();}else this.entries=next;
  }
  append(value) {
    const parsed=row.parse(value);
    this.entries=this.entries.filter(e=>e.id!==parsed.id);this.entries.unshift(parsed);this.prune();return this.save();
  }
  clear(){this.entries=[];this.storageFailed=false;return this.save();}
  snapshot(limit=20){this.prune();return{retentionHours:RESPONSE_LOG_HOURS,maxEntries:RESPONSE_LOG_LIMIT,totalEntries:this.entries.length,
    storageFailed:this.storageFailed,entries:this.entries.slice(0,limit)};}
}
