// @ts-check
export const PULSE_COLORS = Object.freeze({ calm: '#91B59B', laughter: '#71C9B0', excitement: '#F0B45A', anger: '#E47770', confusion: '#B29AD8' });
export const PULSE_LABELS = Object.freeze({ calm: 'Calm', laughter: 'Laugh', excitement: 'Hype', anger: 'Angry', confusion: 'Confused' });
/** @typedef {keyof typeof PULSE_COLORS} Emotion */
/** @typedef {{start:number,count:number,partial:boolean,available:boolean}} Bucket */
/** @typedef {{counts:Record<Emotion,number>,fractions:Record<Emotion,number>,classified:number,unknown:number,insufficient:boolean,emotion:Emotion,simulated:boolean,scenario:string,activity:Bucket[],activityCeiling:number,windowEnd:number,testing?:boolean,analysisMode?:string,analysisStatus?:string,analyzedMessages?:number,accepted?:number,currentAccepted?:number}} PulseView */
/** The same scale is used for all twelve minutes, including the partial minute.
 * @param {number} count @param {number} ceiling */
export const activityHeight = (count, ceiling) => count <= 0 ? 0 : Math.log1p(count) / Math.log1p(ceiling);
/** One compact canvas component shared by preview and OBS.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x:number,y:number,width:number,height:number}} layout
 * @param {PulseView} pulse @param {number} dpr @param {boolean} overlay */
export function drawPulse(ctx, layout, pulse, dpr, overlay) {
  const s = layout.width / 320, x = layout.x + 12 * s, w = layout.width - 24 * s;
  const y = layout.y + 207 * s;
  const ink = overlay ? '#eff5e8' : '#263b36', muted = overlay ? '#b7cbbb' : '#597165';
  const font = Math.max(11 * dpr, 11 * s);
  const text = (/** @type {string} */ value, /** @type {number} */ tx, /** @type {number} */ ty, color = ink, align = 'left') => {
    ctx.font = `600 ${Math.round(font)}px 'Segoe UI',sans-serif`; ctx.fillStyle = color;
    ctx.textAlign = /** @type {CanvasTextAlign} */ (align); ctx.fillText(value, Math.round(tx), Math.round(ty));
  };
  ctx.save();
  // Small transparent-backed chart strips remain legible over moving footage.
  ctx.fillStyle = overlay ? '#15282ce8' : '#dbe5d5';
  ctx.fillRect(Math.round(x - 6 * s), Math.round(y - 14 * s), Math.round(w + 12 * s), Math.round(181 * s));
  text(s < .85 * dpr ? 'PULSE · 60s' : 'CHAT PULSE · 60s', x, y, muted);
  text(pulse.testing ? 'DEMO TEST' : pulse.simulated ? 'DEMO · 12m' : pulse.analysisMode==='ai'?'AI · 60s':'LOCAL', x + w, y, muted, 'right');
  const trackX = x + 68 * s, trackW = w - 109 * s;
  /** @type {Emotion[]} */ const emotions = ['calm', 'laughter', 'excitement', 'anger', 'confusion'];
  emotions.forEach((emotion, i) => {
    const row = y + 19 * s + i * 16 * s;
    text(PULSE_LABELS[emotion], x, row);
    ctx.fillStyle = overlay ? '#ffffff15' : '#a4b59f55';
    ctx.fillRect(Math.round(trackX), Math.round(row - 8 * s), Math.round(trackW), Math.max(2, Math.round(7 * s)));
    const fraction = pulse.fractions[emotion];
    if (fraction > 0) {
      ctx.fillStyle = PULSE_COLORS[emotion];
      ctx.fillRect(Math.round(trackX), Math.round(row - 8 * s), Math.max(1, Math.round(trackW * fraction)), Math.max(2, Math.round(7 * s)));
    }
    text((pulse.analysisMode==='ai'?pulse.analysisStatus==='ready':pulse.classified>0) ? `${Math.round(fraction * 100)}%` : '—', x + w, row, PULSE_COLORS[emotion], 'right');
  });
  const aiStatus=pulse.analysisStatus==='ready'?`${pulse.analyzedMessages} messages · AI scores`:pulse.analysisStatus==='pending'?'AI reading this minute…':pulse.insufficient?`${pulse.currentAccepted??pulse.accepted??0}/5 incoming · next minute`:`AI · ${pulse.analysisStatus||'collecting'}`;
  text(pulse.analysisMode==='ai'?aiStatus:pulse.insufficient ? `Gathering chat · ${pulse.classified} known / ${pulse.unknown} ?` : `${pulse.classified} classified · ${pulse.unknown} unknown`, x, y + 103 * s, muted);
  text('MESSAGES / MIN · 12m', x, y + 122 * s, muted);
  text('log scale', x + w, y + 122 * s, muted, 'right');
  const bottom = y + 155 * s, step = w / 12, barW = Math.max(2, Math.floor(step - 5 * s));
  pulse.activity.forEach((bucket, i) => {
    const bx = x + i * step, h = Math.round(activityHeight(bucket.count, pulse.activityCeiling) * 25 * s);
    ctx.fillStyle = bucket.available ? (bucket.partial ? '#F0B45A' : '#91B59B') : (overlay ? '#ffffff22' : '#82927b44');
    if (bucket.count) ctx.fillRect(Math.round(bx), Math.round(bottom - h), barW, Math.max(1, h));
    else ctx.fillRect(Math.round(bx), Math.round(bottom - 1), barW, 1);
    if (bucket.partial) {
      ctx.strokeStyle = '#F0B45A'; ctx.setLineDash([2 * s, 2 * s]);
      ctx.strokeRect(Math.round(bx), Math.round(bottom - 27 * s), barW, Math.round(29 * s)); ctx.setLineDash([]);
    }
  });
  text('−11m', x, y + 169 * s, muted);
  const current = pulse.activity.at(-1);
  text(`${current?.count || 0} now*`, x + w, y + 169 * s, '#a77839', 'right');
  ctx.restore();
}
/** Accessible counts and a tooltip; statistics describe participating messages, never all viewers.
 * @param {PulseView} p */
export function pulseDescription(p) {
  if(p.analysisMode==='ai')return `Chat Pulse. AI minute sentiment scores: ${Object.entries(p.fractions).map(([e,n])=>`${e} ${Math.round(n*100)}%`).join(', ')}. Status ${p.analysisStatus}. ${p.accepted} accepted messages; ${p.analyzedMessages} texts analyzed. Scores are model assessments, not measured viewer feelings or exact message counts.`;
  return `Chat Pulse. ${p.simulated ? 'Simulated demo history. ' : ''}Last measured 60 seconds: ${Object.entries(p.counts).map(([key, count]) => `${key} ${count}`).join(', ')}; unknown ${p.unknown}. ${p.insufficient ? 'Insufficient evidence for a mood change. ' : ''}Twelve accepted-message counts per minute (last is partial): ${p.activity.map(b => b.available ? b.count : 'unavailable').join(', ')}. Shared logarithmic scale. Participating chat messages, not all viewers.`;
}
