import test from 'node:test';
import assert from 'node:assert/strict';
import { stageSettingsSchema, stageSettingsPatchSchema, stageDefaults } from '../../src/server/stage-settings.js';

// Keep stored-setting compatibility even though retired characters are no longer rendered.
test('old stage settings retain other values and validate legacy interval bounds', () => {
  const old = { ...stageDefaults, tempo: 140, anchor: 'right' }; delete old.rotationSeconds;
  assert.equal(stageSettingsSchema.parse(old).rotationSeconds, 60);
  assert.equal(stageSettingsSchema.parse(old).tempo, 140);
  for (const rotationSeconds of [0, 14, 3601, 15.5, '60']) assert.equal(stageSettingsSchema.safeParse({ ...stageDefaults, rotationSeconds }).success, false);
});
test('partial stage updates preserve omitted saved fields', () => {
  const saved = { ...stageDefaults, rotationSeconds: 120, castMode: 'fixed', selectedCast: 'bront' };
  const update = stageSettingsPatchSchema.parse({ tempo: 130 });
  assert.equal({ ...saved, ...update }.rotationSeconds, 120);
  assert.equal({ ...saved, ...update }.castMode, 'fixed');
  assert.equal({ ...saved, ...update }.selectedCast, 'bront');
});
test('legacy stage fields acquire defaults and reject unrecognized values', () => {
  const old = { ...stageDefaults }; delete old.castMode; delete old.selectedCast;
  const parsed = stageSettingsSchema.parse(old);
  assert.equal(parsed.castMode, 'random'); assert.equal(parsed.selectedCast, 'nib');
  assert.equal(stageSettingsPatchSchema.safeParse({ castMode: 'all' }).success, false);
  assert.equal(stageSettingsPatchSchema.safeParse({ selectedCast: 'sena' }).success, false);
  assert.deepEqual(stageSettingsPatchSchema.parse({ castMode: 'fixed', selectedCast: 'rina' }), { castMode: 'fixed', selectedCast: 'rina' });
});
