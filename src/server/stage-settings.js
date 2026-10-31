import { z } from 'zod';
const rotationInterval = z.number().int().min(15).max(3600);
const castMode = z.enum(['fixed', 'random']);
const selectedCast = z.enum(['nib', 'rina', 'bront']);

export const stageDefaults = Object.freeze({ tempo: 112, scale: 1, cast: 'solo', anchor: 'left', emotes: true, ambient: true, rotationSeconds: 60, castMode: 'random', selectedCast: 'nib' });
export const stageSettingsSchema = z.object({
  tempo: z.number().int().min(60).max(160), scale: z.number().min(.65).max(1.4),
  // Normalize saved v1 cast settings instead of resetting the existing budget ledger.
  cast: z.preprocess(value => value === 'trio' ? 'solo' : value, z.literal('solo')),
  anchor: z.enum(['left', 'center', 'right']),
  emotes: z.boolean(), ambient: z.boolean(),
  rotationSeconds: rotationInterval.default(60),
  castMode: castMode.default('random'), selectedCast: selectedCast.default('nib'),
}).strict();
// Defaults migrate full records, but must not reset an omitted field during PATCH.
export const stageSettingsPatchSchema = stageSettingsSchema.partial().extend({ rotationSeconds: rotationInterval.optional(), castMode: castMode.optional(), selectedCast: selectedCast.optional() });
