import { performanceCue, chatIntent } from './chat.js';

export class Game {
  constructor(now = Date.now) {
    this.now = now; this.activity = 0; this.energy = 25; this.mood = 'cozy';
    this.creatures = [{ id: 0, name: 'Nib', type: 'cozy', xp: 0, expression: 'calm' }];
    this.recent = []; this.evolvedAt = -Infinity; this.eventAt = -Infinity;
    this.event = 'none'; this.eventUntil = 0; this.lastInteraction = null; this.evolutions = 0;
    this.startedAt = now(); this.burst = []; this.emoteAt = new Map(); this.emotes = 0;
  }
  accept(message) {
    this.activity++; this.energy = Math.min(100, this.energy + 2);
    this.recent.push(message.category); this.recent = this.recent.slice(-30);
    const x = .58 + ((message.sequence * 17) % 16) / 100;
    const creature = this.creatures[0];
    creature.xp++; creature.expression = message.category === 'question' ? 'curious' : message.category === 'hype' ? 'excited' : 'happy';
    const performance = message.performance || performanceCue(message.text || '', message.category).performance;
    this.burst = this.burst.filter(m => m.at >= this.now() - 12000).slice(-39);
    this.burst.push({ at: this.now(), category: message.category, performance });
    const sticker = ['bonk', 'recoil'].includes(performance) ? 'bruh' : message.category === 'laughter' ? 'kekw' : message.category === 'hype' ? 'pog' : message.category === 'support' ? 'love' : null;
    const matches = this.burst.filter(m => sticker === 'bruh' ? ['bonk', 'recoil'].includes(m.performance) : m.category === message.category).length;
    let emote = null;
    if (sticker && matches >= 3 && this.now() - (this.emoteAt.get(sticker) ?? -Infinity) >= 16000) {
      emote = sticker; this.emoteAt.set(sticker, this.now()); this.emotes++;
    }
    this.lastInteraction = { sequence: message.sequence, creatureId: creature.id, text: message.text,
      category: message.category, x, action: message.category === 'battle' ? 'battle' : message.category === 'laughter' ? 'bounce' : 'eat',
      performance, explicit: Boolean(message.explicit), emote, combo: matches, at: this.now() };
    this.lastInteraction.intent = message.intent ?? chatIntent(message.text || '', message.category, performance, message.explicit);
    if (message.demoMood) { this.lastInteraction.demoMood = message.demoMood; this.lastInteraction.demoGeneration = message.demoGeneration; }
    if (this.recent.length >= 10) {
      const counts = Object.fromEntries(['support', 'laughter', 'question', 'hype'].map(c => [c, this.recent.filter(v => v === c).length]));
      this.recommend({ creatureType: counts.laughter > counts.support ? 'chaos' : counts.question > counts.support ? 'mystic' : 'cozy',
        energyLevel: this.energy, dominantMood: counts.hype >= 10 ? 'excited' : 'playful',
        recommendedEvent: counts.hype >= 10 ? 'hype_mode' : counts.support >= 10 ? 'feeding_frenzy' : 'none',
      }, { totalMessages: this.recent.length, localCategoryCounts: counts });
    }
    return this.lastInteraction;
  }
  recommend(value, evidence) {
    if (evidence.totalMessages < 10) return false;
    // Body evolution is decided from completed minute sentiment windows in NibEvolution.
    // Legacy AI recommendations may still suggest supported world events, never a body form.
    const enough = value.recommendedEvent === 'hype_mode' ? evidence.localCategoryCounts.hype >= 10 :
      value.recommendedEvent === 'feeding_frenzy' ? evidence.localCategoryCounts.support >= 10 : false;
    if (enough && this.now() - this.eventAt >= 60000) {
      this.event = value.recommendedEvent; this.eventAt = this.now(); this.eventUntil = this.now() + 12000;
    }
    return true;
  }
  resetVisuals() { this.activity = 0; this.evolutions = 0; this.emotes = 0; }
  snapshot() { return { creatures: this.creatures, energy: this.energy, mood: this.mood, activity: this.activity,
    evolutions: this.evolutions, emotes: this.emotes, startedAt: this.startedAt,
    event: this.now() < this.eventUntil ? this.event : 'none', lastInteraction: this.lastInteraction }; }
}
