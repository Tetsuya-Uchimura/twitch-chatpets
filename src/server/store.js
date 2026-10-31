import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';
import { settingsSchema } from './config.js';
import { stageDefaults, stageSettingsSchema } from './stage-settings.js';
import{conversationSettingsSchema}from'./conversation-settings.js';

const recordSchema = z.object({
  id: z.string(), timestamp: z.number(), model: z.string(), inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(), estimatedCost: z.number().nonnegative(),
  reservedCost: z.number().nonnegative(), status: z.enum(['pending', 'success', 'failure']),
  error: z.enum(['request_failed', 'invalid_response', 'cancelled', 'usage_missing', 'stale_response', 'unsupported_configuration']).optional(),
  purpose:z.enum(['analysis','reaction','stream_joke']).optional(),
});
const schema = z.object({ version: z.literal(1), settings: settingsSchema, records: z.array(recordSchema),
  stageSettings: stageSettingsSchema.default({ ...stageDefaults }),
  conversationSettings:conversationSettingsSchema,
});
export class Store {
  constructor(directory, config) {
    fs.mkdirSync(directory, { recursive: true });
    this.file = path.join(directory, 'ai-state.json');
    this.state = fs.existsSync(this.file) ? schema.parse(JSON.parse(fs.readFileSync(this.file, 'utf8'))) : {
      version: 1, settings: { enabled: config.enabled, intervalSeconds: config.intervalSeconds, dailyBudget: config.dailyBudget, dailyBudgetEnabled: config.dailyBudgetEnabled ?? true }, records: [],
    };
    this.save(this.state);
  }
  save(next) {
    const validated = schema.parse(next);
    const temporary = `${this.file}.tmp`;
    const fd = fs.openSync(temporary, 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(validated)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, this.file);
    this.state = validated;
  }
  settings(value) { this.save({ ...this.state, settings: settingsSchema.parse(value) }); }
  stageSettings(value) { this.save({ ...this.state, stageSettings: stageSettingsSchema.parse(value) }); }
  conversationSettings(value){this.save({...this.state,conversationSettings:conversationSettingsSchema.parse(value)});}
  reserve(record) { this.save({ ...this.state, records: [...this.state.records, record] }); }
  finish(id, update) {
    this.save({ ...this.state, records: this.state.records.map(r => r.id === id ? { ...r, ...update } : r) });
  }
  totals(now = Date.now()) {
    const day = new Date(now).toISOString().slice(0, 10);
    const records = this.state.records;
    // Missing usage or crashed requests retain the full reservation permanently for their UTC day.
    const charged = r => r.status === 'success' || (r.inputTokens + r.outputTokens > 0) ? r.estimatedCost : r.reservedCost;
    return {
      totalRequests: records.length, inputTokens: records.reduce((n, r) => n + r.inputTokens, 0),
      outputTokens: records.reduce((n, r) => n + r.outputTokens, 0),
      estimatedCost: records.reduce((n, r) => n + charged(r), 0),
      dailySpent: records.filter(r => new Date(r.timestamp).toISOString().slice(0, 10) === day).reduce((n, r) => n + charged(r), 0),
      hourlyCalls: records.filter(r => r.timestamp > now - 3600000).length,
    };
  }
}

// One server per data directory; never run competing budget writers.
export function acquireLock(directory, { namespace = 'local' } = {}) {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'server.lock');
  if (fs.existsSync(file)) {
    let value;
    try { value = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { throw new Error('Invalid server lock; inspect data/server.lock.'); }
    const legacy = Number.isInteger(value) && value > 0;
    const parsed = z.object({ version: z.literal(1), pid: z.number().int().positive(), host: z.string().min(1), namespace: z.enum(['local', 'container']) }).strict().safeParse(value);
    if (!legacy && !parsed.success) throw new Error('Invalid server lock; inspect data/server.lock.');
    // A PID from another host/container namespace cannot prove that its writer has stopped.
    if (legacy ? namespace !== 'local' : value.host !== os.hostname() || value.namespace !== namespace) throw new Error('Server lock belongs to another runtime; stop it before sharing data.');
    const pid = legacy ? value : value.pid;
    try { process.kill(pid, 0); } catch (error) {
      if (error.code !== 'ESRCH') throw new Error('Cannot verify server lock.');
      fs.unlinkSync(file);
    }
  }
  const content = JSON.stringify({ version: 1, pid: process.pid, host: os.hostname(), namespace });
  const fd = fs.openSync(file, 'wx', 0o600);
  fs.writeFileSync(fd, content);
  let released = false;
  return () => {
    if (released) return;
    released = true; fs.closeSync(fd);
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) fs.unlinkSync(file);
  };
}
