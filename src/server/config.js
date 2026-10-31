import { z } from 'zod';

const number = (fallback, min, max, integer = true) => z.preprocess(
  v => v === undefined || v === '' ? fallback : Number(v),
  integer ? z.number().int().min(min).max(max) : z.number().min(min).max(max),
);
const bool = fallback => z.preprocess(v => v === undefined ? fallback : v, z.union([
  z.boolean(), z.enum(['true', 'false']).transform(v => v === 'true'),
]));
export const settingsSchema = z.object({
  enabled: z.boolean(), intervalSeconds: z.number().int().min(10).max(86400),
  dailyBudget: z.number().min(0).max(100), dailyBudgetEnabled: z.boolean().default(true),
}).strict();
const twitchChannelSchema = z.string().trim().transform((value, context) => {
  if (/^[a-zA-Z0-9_]*$/.test(value)) return value.toLowerCase();
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && ['twitch.tv', 'www.twitch.tv'].includes(url.hostname) &&
        !url.username && !url.password && !url.port && !url.search && !url.hash &&
        /^\/[a-zA-Z0-9_]+\/?$/.test(url.pathname)) return url.pathname.split('/')[1].toLowerCase();
  } catch { /* Report configuration errors without echoing environment values. */ }
  context.addIssue({ code: 'custom', message: 'Use a Twitch channel login or its HTTPS channel URL.' });
  return z.NEVER;
});
export function loadConfig(env = process.env) {
  const parsed = z.object({
    DEMO_MODE: bool(true), OPENAI_API_ENABLED: bool(false),
    OPENAI_MODEL: z.string().trim().min(1).default('gpt-6-luna'),
    OPENAI_ANALYSIS_INTERVAL_SECONDS: number(60, 10, 86400),
    OPENAI_MAX_MESSAGES_PER_BATCH: number(100, 1, 100),
    OPENAI_MAX_INPUT_CHARS: number(8000, 512, 8000),
    OPENAI_MAX_OUTPUT_TOKENS: number(250, 64, 250),
    // Zero explicitly disables only the hourly call cap; budget and concurrency still apply.
    OPENAI_MAX_CALLS_PER_HOUR: number(20, 0, 20),
    OPENAI_DAILY_BUDGET_USD: number(0.10, 0, 100, false),
    OPENAI_DAILY_BUDGET_ENABLED: bool(true),
    OPENAI_REASONING_EFFORT: z.enum(['none', 'minimal', 'low', 'medium', 'high']).default('none'),
    // Conservative configurable estimates, NOT a claim about current model pricing.
    OPENAI_INPUT_PRICE_PER_MILLION: number(1, 0.000001, 1000, false),
    OPENAI_OUTPUT_PRICE_PER_MILLION: number(5, 0.000001, 1000, false),
    OPENAI_TIMEOUT_MS: number(15000, 100, 60000),
    PORT: number(3000, 0, 65535),
    APP_NETWORK_MODE: z.enum(['local', 'container']).default('local'),
    TWITCH_CHANNEL: twitchChannelSchema.default(''),
    TWITCH_CLIENT_ID: z.string().trim().default(''),
    TWITCH_CLIENT_SECRET: z.string().trim().default(''),
    BLOCKED_TERMS: z.string().default(''),
    OPENAI_INCLUDE_REPRESENTATIVES: bool(false),
    CHAT_PULSE_MIN_MESSAGES: number(5, 1, 100),
    CHAT_PULSE_MIN_USERS: number(1, 1, 100),
    CHAT_PULSE_COOLDOWN_SECONDS: number(30, 0, 3600),
    CHAT_PULSE_DOMINANCE: number(.4, .4, 1, false),
  }).parse(env);
  return {
    demo: parsed.DEMO_MODE, apiKey: env.OPENAI_API_KEY || '', model: parsed.OPENAI_MODEL,
    enabled: parsed.OPENAI_API_ENABLED, intervalSeconds: parsed.OPENAI_ANALYSIS_INTERVAL_SECONDS,
    dailyBudget: parsed.OPENAI_DAILY_BUDGET_USD, dailyBudgetEnabled: parsed.OPENAI_DAILY_BUDGET_ENABLED, maxMessages: parsed.OPENAI_MAX_MESSAGES_PER_BATCH,
    maxInputChars: parsed.OPENAI_MAX_INPUT_CHARS, maxOutputTokens: parsed.OPENAI_MAX_OUTPUT_TOKENS,
    hourlyLimit: parsed.OPENAI_MAX_CALLS_PER_HOUR, effort: parsed.OPENAI_REASONING_EFFORT,
    inputPrice: parsed.OPENAI_INPUT_PRICE_PER_MILLION, outputPrice: parsed.OPENAI_OUTPUT_PRICE_PER_MILLION,
    timeoutMs: parsed.OPENAI_TIMEOUT_MS, port: parsed.PORT, networkMode: parsed.APP_NETWORK_MODE,
    bindHost: parsed.APP_NETWORK_MODE === 'container' ? '0.0.0.0' : '127.0.0.1', channel: parsed.TWITCH_CHANNEL.toLowerCase(),
    twitchClientId: parsed.TWITCH_CLIENT_ID, twitchClientSecret: parsed.TWITCH_CLIENT_SECRET,
    blockedTerms: parsed.BLOCKED_TERMS.split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
    representatives: parsed.OPENAI_INCLUDE_REPRESENTATIVES,
    pulse: { minMessages: parsed.CHAT_PULSE_MIN_MESSAGES, minUsers: parsed.CHAT_PULSE_MIN_USERS,
      cooldownSeconds: parsed.CHAT_PULSE_COOLDOWN_SECONDS, dominance: parsed.CHAT_PULSE_DOMINANCE },
  };
}
