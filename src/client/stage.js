import { StageDirector, clamp, PLAY_WIDTH, PLAY_HEIGHT, FLOOR, HOME } from './stage-model.js';
import {compileEvolvedNib as compileSprite,generateEvolvedNib,FRAME_COUNTS,SPRITE_WIDTH,SPRITE_GROUND} from './nib-evolution-sprites.js';
import { drawPulse, pulseDescription, PULSE_COLORS } from './pulse-view.js';
import {NIB_FORMS,EMOTION_FORM} from '../shared/nib-forms.js';
import{EvolutionSequence}from'./evolution-sequence.js';
import{compileMorphSprite,evolutionPose,paintEvolutionEffects}from'./evolution-effects.js';
import { SpeechSequence, SPEECH_MOTION_MS, drawSpeech, drawConversationEvent } from './conversation-view.js';

const defaults = { tempo: 112, scale: 1, cast: 'solo', anchor: 'left', emotes: true, ambient: true };
export function habitatLayout(width, height, dpr, settings, overlay) {
  const padding = Math.round((overlay ? 14 : 8) * dpr);
  const widgetHeight = settings.conversationEvent ? 470 : 380;
  const size = Math.min(settings.scale * dpr, (width - padding * 2) / 320, (height - padding * 2) / widgetHeight);
  // Each authored sprite pixel occupies an integer number of device pixels, including at fractional DPR.
  const w = Math.max(1, Math.round(320 * size)), h = Math.max(1, Math.round(widgetHeight * size));
  const zoom = w / PLAY_WIDTH, unit = Math.max(1, Math.round(3 * zoom));
  const anchor = overlay ? settings.anchor : 'center';
  return { unit, zoom, x: Math.round(anchor === 'left' ? padding : anchor === 'right' ? width - w - padding : (width - w) / 2),
    y: Math.round(overlay ? height - h - padding : (height - h) / 2), width: w, height: h,
    mirrored: settings.anchor === 'right' };
}
export function capsuleGeometry(ctx, content, bodyWidth, zoom, dpr) {
  const fontSize = Math.max(Math.round(12 * dpr), Math.round(14 * zoom));
  ctx.font = `600 ${fontSize}px 'Segoe UI',sans-serif`;
  const padding = Math.max(8, Math.round(14 * zoom));
  const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(String(content))].slice(0, 40).map(s => s.segment);
  let label = segments.join(''); const max = Math.floor(bodyWidth);
  while (segments.length && ctx.measureText(label).width > max - padding) { segments.pop(); label = segments.join('') + '…'; }
  const width = clamp(Math.ceil(ctx.measureText(label).width + padding), Math.ceil(bodyWidth * .4), max);
  return { label, width, height: Math.max(Math.round(25 * zoom), fontSize + Math.round(10 * zoom)), fontSize, ratio: width / bodyWidth };
}
export function mountStage(canvas, { overlay = false, onStatus = () => {}, initialForm='base', playOnly=false } = {}) {
  initialForm=Object.hasOwn(NIB_FORMS,initialForm)?initialForm:'base';
  const display = canvas.getContext('2d'), buffer = document.createElement('canvas');
  const ctx = buffer.getContext('2d'), director = new StageDirector(), cache = new Map();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let state, session, settings = { ...defaults }, dpr = 1, width = 1, height = 1, clockOffset = 0;
  let frameId, paused = false, frozenAt = 0, pauseOffset = 0, dirty = true, lastStatusAt = 0;
  let evolution=new EvolutionSequence(initialForm),transitionPause=0,transitionAt=null,transitionDuration=0,anchor={x:HOME,facing:1};
  let frameErrors = 0, lastWarningAt = -Infinity;
  let appliedForm='base',castAction='',castActionAt=0;
  const speech = new SpeechSequence(); let speechPause = 0, speechAt = null, conversationEvent = null;
  const currentTime = () => (paused ? frozenAt : performance.now()) + clockOffset - pauseOffset;
  const desiredForm=()=>{const target=state?.demo&&state.demoMood?EMOTION_FORM[state.demoMood]:(state?.evolution?.form||'base');return Object.hasOwn(NIB_FORMS,target)?target:'base';};
  const worldTime=now=>now-transitionPause-speechPause-(speechAt===null?0:Math.min(Math.max(0,now-speechAt),SPEECH_MOTION_MS))-(transitionAt===null?0:Math.min(Math.max(0,now-transitionAt),transitionDuration));
  function resize() {
    const bounds = canvas.getBoundingClientRect(); dpr = Math.min(devicePixelRatio || 1, 3);
    // A hidden/minimized source must not replace a good frame with a 1 × 1 canvas.
    if (bounds.width <= 0 || bounds.height <= 0) return;
    width = Math.max(1, Math.round(bounds.width * dpr)); height = Math.max(1, Math.round(bounds.height * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    if (buffer.width !== width || buffer.height !== height) { buffer.width = width; buffer.height = height; }
    ctx.imageSmoothingEnabled = false; display.imageSmoothingEnabled = false; dirty = true;
  }
  const observer = new ResizeObserver(resize); observer.observe(canvas);
  function update(value) {
    state = value; settings = { ...defaults, ...value.stageSettings, cast: 'solo' };
    if (session !== value.sessionId) {
      session = value.sessionId; clockOffset = (value.serverTime || Date.now()) - performance.now(); pauseOffset = 0; paused = false;
      director.reset(value.game.startedAt || Date.now());evolution=new EvolutionSequence(initialForm);transitionPause=0;transitionAt=null;transitionDuration=0;
      appliedForm=initialForm;castAction='';
      speech.reset(); speechPause=0; speechAt=null;
    }
    settings.emotion = value.demo && value.demoMood ? value.demoMood : value.pulse?.emotion || 'calm';
    settings.demoGeneration = value.demoGeneration;
    conversationEvent = value.conversation?.event || null; settings.conversationEvent = Boolean(conversationEvent);
    if (value.conversation?.settings.enabled === false) conversation({type:'clear'});
    if (value.conversation?.speech) conversation({type:'speech',speech:value.conversation.speech});
    if (value.pulse) {
      const description = pulseDescription(value.pulse); canvas.setAttribute('aria-label', `Nib. ${description}`); if (canvas.dataset.castReady !== 'failed') canvas.title = description;
    }
    evolution.request(desiredForm());dirty = true;
  }
  function spriteData(action, frame, form, emotion, gesture) {
    const index = Math.abs(frame) % (FRAME_COUNTS[action] || 4);
    const key = `${action}:${index}:${form}:${emotion}:${gesture.headTilt}:${gesture.tailFrame}:${gesture.squat}:${gesture.softSmile}:${gesture.arms}`;
    if (!cache.has(key)) { if (cache.size >= 1024) cache.clear(); cache.set(key, compileSprite(action, index, form, emotion, gesture)); }
    return cache.get(key);
  }
  function render(now) {
    evolution.request(desiredForm());
    if (speechAt !== null && (now - speechAt >= SPEECH_MOTION_MS || !speech.current)) { speechPause += Math.min(Math.max(0,now-speechAt),SPEECH_MOTION_MS); speechAt=null; }
    speech.advance(now, desiredForm());
    const logicalNow=worldTime(now),wasActive=evolution.active;
    let [actor]=director.tick(logicalNow,{...settings,holdActions:evolution.holding||Boolean(speech.pending.length)||Boolean(speech.emoting(now))});
    if(playOnly)actor={...actor,x:PLAY_WIDTH/2};
    const scene=evolution.tick(now,actor.active||Boolean(speech.emoting(now)),reduced.matches);
    if (speech.start(now,scene.form,scene.active||evolution.holding||actor.active) && speech.emoting(now)) speechAt=now;
    if (!scene.active) actor=speech.pose(actor,now,reduced.matches);
    if (!actor.active && !speech.current && speech.thinking && !scene.active) actor={...actor,action:'notice',headTilt:1,facing:1};
    let layout=habitatLayout(width,height,dpr,settings,overlay);
    if(playOnly){const size=Math.min(settings.scale*dpr,(width-28*dpr)/320,(height-28*dpr)/(PLAY_HEIGHT*320/PLAY_WIDTH)),w=320*size,zoom=w/PLAY_WIDTH,h=PLAY_HEIGHT*zoom;layout={unit:Math.max(1,Math.round(3*zoom)),zoom,x:Math.round((width-w)/2),y:Math.round((height-h)/2),width:w,height:h,mirrored:false};}
    if(!wasActive&&evolution.active){transitionAt=now;transitionDuration=scene.duration;anchor={x:actor.x,facing:actor.facing};}
    if(wasActive&&!evolution.active){transitionPause+=Math.min(Math.max(0,now-wasActive.start),wasActive.duration);transitionAt=null;}
    appliedForm=scene.form;const target=evolution.target;
    const transform=scene.active?evolutionPose(scene,reduced.matches):null;
    if(transform)actor={...actor,x:anchor.x,facing:anchor.facing,action:transform.action,jump:transform.lift,phase:'evolution',note:null,performance:null,capsuleVisible:false};
    const actionKey=`${actor.action}:${actor.note?.sequence||0}`;
    if(castAction!==actionKey){castAction=actionKey;castActionAt=now;}
    canvas.dataset.cast='nib';canvas.dataset.castMode='fixed';canvas.dataset.castReady='true';
    canvas.dataset.evolutionForm=appliedForm;canvas.dataset.evolutionTarget=target;canvas.dataset.evolutionPending=String(evolution.holding);canvas.dataset.evolutionPhase=scene.phase;canvas.dataset.evolutionFrom=scene.from;canvas.dataset.evolutionTo=scene.to;canvas.dataset.evolutionElapsed=String(scene.elapsed);canvas.dataset.evolutionDuration=String(scene.duration);canvas.dataset.evolutionCompleted=String(scene.completed);canvas.dataset.queueLength=String(actor.queue.length);
    if (![actor?.x, actor?.jump, actor?.frame, layout.unit, layout.x, layout.y].every(Number.isFinite)) throw new Error('invalid_pose');
    const { zoom, mirrored } = layout;
    const unit = speech.current && !scene.active ? Math.max(1,Math.round(2*zoom)) : layout.unit;
    const X = x => Math.round(layout.x + (mirrored ? PLAY_WIDTH - x : x) * zoom);
    const Y = y => Math.round(layout.y + y * zoom);
    const px = (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))); };
    const dot = (x, y, w, h, color) => px(X(x) - Math.round(w * zoom / 2), Y(y), w * zoom, h * zoom, color);
    const label = (str, x, y, size, color = '#243941') => { ctx.font = `700 ${Math.round(size * zoom)}px 'Segoe UI',sans-serif`; ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.fillText(str, X(x), Y(y)); };
    const star = (x, y, color, s = 1) => { dot(x, y - 3 * s, 2 * s, 8 * s, color); dot(x, y, 8 * s, 2 * s, color); };
    function pixelBox(x, y, w, h, fill, border = '#263b40') {
      const cut = Math.max(1, Math.round(3 * zoom)), edge = Math.max(1, Math.round(2 * zoom));
      px(x + cut, y, w - cut * 2, h, border); px(x, y + cut, w, h - cut * 2, border);
      px(x + cut, y + edge, w - cut * 2, h - edge * 2, fill); px(x + edge, y + cut, w - edge * 2, h - cut * 2, fill);
    }
    let lastRatio = null, lastCapsuleLabel = '';
    function capsule(note, x, y, { muted = false, enemy = false, alpha = 1 } = {}) {
      const bodyWidth = SPRITE_WIDTH * unit;
      const box = capsuleGeometry(ctx, note.text, bodyWidth, zoom, dpr); lastRatio = box.ratio; lastCapsuleLabel = box.label;
      const left = Math.round(X(x) - box.width / 2), top = Math.round(Y(y) - box.height / 2);
      const fill = enemy ? '#efb3a2' : note.category === 'hype' ? '#fbe3a2' : note.category === 'question' ? '#bedfeb' : note.category === 'laughter' ? '#d2c5ed' : '#f6efd8';
      ctx.save(); ctx.globalAlpha = alpha * (muted ? .48 : 1);
      pixelBox(left, top, box.width, box.height, fill);
      ctx.font = `600 ${box.fontSize}px 'Segoe UI',sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = '#243941';
      ctx.fillText(box.label, Math.round(left + box.width / 2), Math.round(top + (box.height + box.fontSize * .7) / 2), box.width - 8);
      if (enemy) {
        px(left + unit * 2, top - unit, unit * 2, unit, '#263b40'); px(left + box.width - unit * 4, top - unit, unit * 2, unit, '#263b40');
        px(left + unit * 3, top - 1, unit, unit, '#263b40'); px(left + box.width - unit * 4, top - 1, unit, unit, '#263b40');
      }
      ctx.restore();
    }
    ctx.clearRect(0, 0, width, height); ctx.imageSmoothingEnabled = false;
    ctx.save(); ctx.beginPath(); ctx.rect(layout.x, layout.y, layout.width, PLAY_HEIGHT * zoom); ctx.clip();
    if (!overlay) for (let x = 26; x < 337; x += 11) dot(x, FLOOR + 5, 5, 1, '#97a99066');
    // Only the current object and two queued objects are visible; no wide chat wall.
    const waiting = director.notes.filter(n => n.sequence !== actor.note?.sequence && logicalNow - n.arrived < 2200).slice(-2);
    if (!speech.current) waiting.forEach((note, index) => capsule(note, 260, 52 + index * 33, { muted: true, alpha: clamp(1 - (logicalNow - note.arrived) / 2200, 0, 1) }));
    if (actor.note && actor.capsuleVisible) {
      const arrive = clamp((logicalNow - actor.note.start) / 210, 0, 1);
      const x = actor.note.target + (1 - arrive) * 44;
      capsule(actor.note, actor.performance === 'sleep' ? HOME + 100 : x, actor.capsuleY,
        { enemy: actor.performance === 'attack' });
      if (actor.phase === 'inspect') label('?', actor.x + 33, FLOOR - 109, 17, '#477483');
    }
    const ground = Y(FLOOR);
    dot(actor.x, FLOOR + 1, actor.action === 'sleep' ? 92 : 70, 4, overlay ? '#243b4140' : '#53695635');
    const powering = actor.performance === 'powerup';
    const action = actor.action;
    const frame = reduced.matches && ['happy', 'jump'].includes(action) ? 0 : transform?transform.frame:actor.frame;
    const extraHop = !transform && !reduced.matches && ['happy', 'evolve'].includes(action) ? -Math.abs(Math.sin((now-castActionAt)/150))*12 : 0;
    const jump = reduced.matches ? actor.jump * .18 : actor.jump + extraHop;
    const gesture = { headTilt: actor.headTilt || 0, tailFrame: actor.tailFrame, squat: actor.squat || 0,
      softSmile: Boolean(actor.softSmile), arms: Boolean(actor.arms) };
    if(transform){gesture.squat=transform.squat;gesture.arms=transform.arms;gesture.headTilt=0;}
    let sprite;
    if(transform){
      const key=`morph:${scene.from}:${scene.to}:${action}:${frame}:${transform.squat}:${Math.round(transform.shape*16)}:${Math.round(transform.color*16)}`;
      if(!cache.has(key)){if(cache.size>=1024)cache.clear();const from=generateEvolvedNib(action,frame,scene.from,NIB_FORMS[scene.from].emotion||'calm',gesture),to=generateEvolvedNib(action,frame,scene.to,NIB_FORMS[scene.to].emotion||'calm',gesture);cache.set(key,compileMorphSprite(from,to,transform.shape,transform.color));}
      sprite=cache.get(key);
    }else sprite=spriteData(action,frame,appliedForm,actor.emotion,gesture);
    const spriteW = SPRITE_WIDTH * unit;
    const center = clamp(X(actor.x), layout.x + spriteW / 2 + 1, layout.x + layout.width - spriteW / 2 - 1);
    const top = Math.max(Y(4), Math.round(ground - SPRITE_GROUND * unit + jump * zoom));
    const left = Math.round(center - spriteW / 2), flipped = (mirrored ? -1 : 1) * actor.facing < 0;
    if(scene.active)paintEvolutionEffects(ctx,scene,center,ground,zoom,reduced.matches,false,layout.x+layout.width/2);
    let spritePixels = 0;
    for (const [color, spans] of sprite.colors) {
      ctx.fillStyle = sprite.palette[color];
      for (const span of spans) {
        const x = flipped ? sprite.width - span.x - span.width : span.x;
        ctx.fillRect(left + x * unit, top + span.y * unit, span.width * unit, unit);
        spritePixels += span.width;
      }
    }
    if(scene.active)paintEvolutionEffects(ctx,scene,center,ground,zoom,reduced.matches,true,layout.x+layout.width/2);
    canvas.dataset.spritePixels = String(spritePixels);
    canvas.dataset.spriteRenderer = 'pixel-spans-v2';
    if (spritePixels < 300) throw new Error('empty_sprite');
    if (actor.action === 'notice' && actor.phase === 'notice') {
      dot(actor.x, FLOOR - 121, 3, 10, '#e1a34a'); dot(actor.x, FLOOR - 108, 3, 3, '#263b40');
    }
    if (actor.action === 'sleep') label(Math.floor(now / 750) % 2 ? 'zZ' : 'z', actor.x + 36, FLOOR - 65, 15, overlay ? '#b7cbb0' : '#577360');
    if (actor.action === 'run' && !reduced.matches) for (let i = 0; i < 3; i++) {
      const t = ((now / 90 + i) % 3) / 3;
      dot(actor.x - actor.facing * (38 + i * 8), FLOOR - i * 2, 3 + i * 2, 3, '#afbc9e' + (t > .5 ? '66' : 'bb'));
    }
    if (actor.action === 'happy') { star(actor.x - 52, FLOOR - 66, '#d7a34b'); star(actor.x + 48, FLOOR - 92, '#75a267'); }
    if (actor.emotion === 'anger' && actor.phase === 'idle') { label('hmph', actor.x + 53, FLOOR - 88, 12, '#E47770'); }
    if (actor.emotion === 'confusion') label('?', actor.x + 36, FLOOR - 102, 17, PULSE_COLORS.confusion);
    if (actor.emotion === 'excitement' && !reduced.matches) star(actor.x - 42, FLOOR - 72 + Math.sin(now / 180) * 7, PULSE_COLORS.excitement);
    if (actor.emotion === 'laughter') star(actor.x + 43, FLOOR - 75, PULSE_COLORS.laughter, .7);
    if (powering) for (let i = 0; i < 6; i++) {
      const angle = now / 550 + i * Math.PI / 3;
      star(actor.x + Math.round(Math.cos(angle) * 58), FLOOR - 50 + Math.round(Math.sin(angle) * 52), i % 2 ? '#b9a1ef' : '#f2d17b');
    }
    for (const effect of director.effects) {
      const t = (logicalNow - effect.at) / 650;
      for (let i = 0; i < 9; i++) {
        const dx = ((i * 17 + effect.seed) % 45 - 22) * t * 2;
        const dy = -((i * 7) % 28 + 8) * t + 35 * t * t;
        const colors = effect.kind === 'stomp' ? ['#E47770', '#f3c5a0', '#b2a284'] : effect.kind === 'cyan' ? ['#71C9B0', '#bcf0df', '#91B59B'] :
          effect.kind === 'sparkle' || effect.kind === 'landing' ? ['#F0B45A', '#fff0ba', '#f8ca79'] :
          effect.kind === 'question' ? ['#B29AD8', '#ded3f4', '#91B59B'] : effect.kind === 'hit' || effect.kind === 'ouch' ? ['#f3aa86', '#f4d485', '#263b40'] : ['#d9f5a4', '#f4d485', '#a8d7ae'];
        const strength = reduced.matches ? .3 : effect.strength || 1;
        dot(effect.x + dx * strength, FLOOR - 18 + dy * strength, t > .7 ? 2 : 4, t > .7 ? 2 : 4, colors[i % 3]);
      }
      if (effect.kind === 'question') label('?', effect.x, FLOOR - 44 - t * 15, 14, '#B29AD8');
      if (['stomp', 'landing'].includes(effect.kind)) dot(effect.x, FLOOR + 2, 18 + t * 48, 2, t < .5 ? '#cbb997' : '#cbb99755');
    }
    if (director.stickers.length && !speech.current) {
      const sticker = director.stickers.at(-1), t = (logicalNow - sticker.start) / 2400;
      const content = { kekw: 'KEKW', pog: 'POG!', bruh: 'BRUH', love: 'BIG W' }[sticker.kind];
      capsule({ text: content, category: sticker.kind === 'pog' ? 'hype' : 'laughter' }, 114, 34 - (reduced.matches ? 0 : Math.sin(t * Math.PI) * 7), { alpha: Math.min(1, (1 - t) * 5) });
    }
    if (!scene.active) drawSpeech(ctx,layout,speech.current,speech.thinking,now);
    ctx.restore();
    drawConversationEvent(ctx,layout,conversationEvent,now);
    if (state?.pulse) drawPulse(ctx, conversationEvent?{...layout,y:layout.y+90*layout.width/320}:layout, { ...state.pulse, testing: Boolean(state.demo && state.demoMood) }, dpr, overlay);
    canvas.dataset.speechId=speech.current?.id||''; canvas.dataset.speechText=speech.current?.text||'';
    canvas.dataset.speechAnimation=speech.current?.animation||''; canvas.dataset.speechStarted=String(speech.current?.started||0);
    if (speech.current || conversationEvent) canvas.setAttribute('aria-label',`Nib. ${speech.current?.text||''} ${conversationEvent?conversationEvent.prompt+' '+conversationEvent.command:''}`);
    canvas.dataset.speechEmoting=String(Boolean(speech.emoting(now)));canvas.dataset.conversationEvent=conversationEvent?.kind||'';
    canvas.dataset.emotion = actor.emotion;
    canvas.dataset.intent = actor.intent || ''; canvas.dataset.variant = actor.variantId || '';
    canvas.dataset.primitive = actor.primitive || actor.action;
    canvas.dataset.consumed = String(Boolean(actor.note?.consumed));
    canvas.dataset.completed = JSON.stringify(director.completed);
    canvas.dataset.requestedEmotion = settings.emotion;
    canvas.dataset.widgetWidth = String(layout.width / dpr); canvas.dataset.widgetHeight = String(layout.height / dpr);
    if (state?.pulse) { canvas.dataset.pulseGeneration=String(state.pulse.generation||0);canvas.dataset.pulseCounts = JSON.stringify(state.pulse.counts); canvas.dataset.activityBuckets = JSON.stringify(state.pulse.activity); }
    if (now - lastStatusAt > 150 || dirty) {
      lastStatusAt = now; canvas.dataset.actions = action; canvas.dataset.performance = actor.performance || '';
      canvas.dataset.phase = actor.phase; canvas.dataset.stickers = director.stickers.map(s => s.kind).join(',');
      canvas.dataset.mascotCount = '1'; canvas.dataset.pixelUnit = String(unit);
      canvas.dataset.textRatio = lastRatio === null ? '' : String(lastRatio);
      canvas.dataset.capsuleLabel = lastCapsuleLabel;
      canvas.dataset.form = appliedForm;
      onStatus({actions:[action],label:scene.active?`${NIB_FORMS[scene.from].name} → ${NIB_FORMS[scene.to].name}`:`${NIB_FORMS[appliedForm].name} / ${action.toUpperCase()}`,form:appliedForm,target,pending:evolution.holding,
        transforming:scene.active,evolutionPhase:scene.phase,queue:actor.queue.length,paused,active:actor.active,variant:actor.variantId});
    }
  }
  function frame() {
    // Schedule first: a failed paint must never permanently stop the animation loop.
    frameId = requestAnimationFrame(frame);
    if (!paused || dirty) {
      try {
        if (ctx.isContextLost?.() || display.isContextLost?.()) { dirty = true; return; }
        render(currentTime());
        if (ctx.isContextLost?.()) { dirty = true; return; }
        // Commit only a complete frame. "copy" replaces transparent pixels without clearing first.
        display.save();
        try { display.globalCompositeOperation = 'copy'; display.drawImage(buffer, 0, 0); }
        finally { display.restore(); }
        canvas.dataset.lastPaint = String(performance.now()); dirty = false;
      } catch {
        frameErrors++; canvas.dataset.frameErrors = String(frameErrors); canvas.dataset.renderError = 'frame_failed';
        buffer.width = width; ctx.imageSmoothingEnabled = false; dirty = true;
        if (performance.now() - lastWarningAt > 5000) {
          lastWarningAt = performance.now(); console.warn('Nib recovered from a drawing failure; the previous frame was retained.');
        }
      }
    }
  }
  function restoreContext() { cache.clear(); buffer.width = width; resize(); dirty = true; }
  function resumeVisible() { if (!document.hidden) resize(); }
  function contextLost(event) { event.preventDefault(); dirty = true; }
  canvas.addEventListener('contextlost', contextLost); canvas.addEventListener('contextrestored', restoreContext);
  buffer.addEventListener('contextlost', contextLost); buffer.addEventListener('contextrestored', restoreContext);
  document.addEventListener('visibilitychange', resumeVisible); window.addEventListener('pageshow', resumeVisible);
  frameId = requestAnimationFrame(frame);
  function conversation(event) {
    if (event.type==='event') { conversationEvent=event.event; settings.conversationEvent=Boolean(conversationEvent); }
    if (event.type==='clear') { conversationEvent=null;settings.conversationEvent=false; }
    speech.receive(event,currentTime()); dirty=true;
  }
  return { update, receive(value) { const accepted = director.receive(value, worldTime(currentTime()), {...settings,holdActions:evolution.holding||Boolean(speech.pending.length)||Boolean(speech.emoting(currentTime()))});
      if (accepted) canvas.dataset.lastReceived = String(value.sequence); return accepted; },
    conversation,
    togglePause() { if (paused) pauseOffset += performance.now() - frozenAt; else frozenAt = performance.now(); paused = !paused; dirty = true; return paused; },
    destroy() { cancelAnimationFrame(frameId); observer.disconnect(); cache.clear();
      canvas.removeEventListener('contextlost', contextLost); canvas.removeEventListener('contextrestored', restoreContext);
      buffer.removeEventListener('contextlost', contextLost); buffer.removeEventListener('contextrestored', restoreContext);
      document.removeEventListener('visibilitychange', resumeVisible); window.removeEventListener('pageshow', resumeVisible); },
  };
}
