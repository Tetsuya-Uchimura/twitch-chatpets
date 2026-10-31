import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../src/server/config.js';

test('Twitch startup accepts channel logins and HTTPS channel URLs, rejecting other destinations', () => {
  for (const input of ['uttie_pp', ' UTTIE_PP ', 'https://www.twitch.tv/uttie_pp', 'https://twitch.tv/UTTIE_PP/']) {
    const config = loadConfig({ DEMO_MODE: 'false', TWITCH_CHANNEL: input });
    assert.equal(config.channel, 'uttie_pp'); assert.equal(config.demo, false); assert.equal(config.enabled, false);
  }
  assert.equal(loadConfig({}).channel, '');
  for (const input of ['https://example.com/uttie_pp', 'https://www.twitch.tv.evil.test/uttie_pp',
    'http://www.twitch.tv/uttie_pp', 'https://user:password@www.twitch.tv/uttie_pp',
    'https://www.twitch.tv/uttie_pp/videos', 'https://www.twitch.tv/', 'uttie_pp\r\nJOIN #other']) {
    assert.throws(() => loadConfig({ TWITCH_CHANNEL: input }));
  }
});
