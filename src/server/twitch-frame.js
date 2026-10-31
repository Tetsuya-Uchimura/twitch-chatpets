// Server-only app credentials. Tokens and image bytes are never persisted or exposed in state.
const MAX_IMAGE_BYTES = 512 * 1024;
async function bounded(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) throw new Error('frame_too_large');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('frame_unavailable');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.length; if (size > limit) throw new Error('frame_too_large');
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => {}); }
}
export class TwitchFrame {
  constructor({config, now = Date.now, fetch: fetcher = globalThis.fetch}) {
    Object.assign(this, {config, now, fetch: fetcher}); this.token = null;
  }
  get configured() { return Boolean(this.config.channel && this.config.twitchClientId && this.config.twitchClientSecret); }
  async accessToken(signal) {
    if (this.token && this.token.expires > this.now() + 60000) return this.token.value;
    const response = await this.fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST', signal, redirect: 'error', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({client_id: this.config.twitchClientId, client_secret: this.config.twitchClientSecret, grant_type: 'client_credentials'}),
    });
    if (!response.ok) throw new Error('twitch_auth_failed');
    let data; try { data = JSON.parse((await bounded(response, 8192)).toString('utf8')); } catch { throw new Error('twitch_auth_failed'); }
    if (typeof data.access_token !== 'string' || !data.access_token || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new Error('twitch_auth_failed');
    this.token = {value: data.access_token, expires: this.now() + data.expires_in * 1000}; return this.token.value;
  }
  async capture(signal, {width=512,height=288}={}) {
    if (!this.configured) throw new Error('twitch_credentials_missing');
    signal = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
    const url = new URL('https://api.twitch.tv/helix/streams'); url.searchParams.set('user_login', this.config.channel);
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.accessToken(signal);
      response = await this.fetch(url, {signal, redirect: 'error', headers: {'Client-Id': this.config.twitchClientId, Authorization: `Bearer ${token}`}});
      if (response.status !== 401 || attempt === 1) break;
      await response.body?.cancel(); this.token = null;
    }
    if (!response.ok) throw new Error(response.status === 401 ? 'twitch_auth_failed' : 'twitch_unavailable');
    let data; try { data = JSON.parse((await bounded(response, 65536)).toString('utf8')); } catch { throw new Error('twitch_unavailable'); }
    if (!Array.isArray(data.data)) throw new Error('twitch_unavailable');
    const stream = data.data.find(v => v.user_login === this.config.channel && v.type === 'live');
    if (!stream) throw new Error('stream_offline');
    let imageURL;
    try {
      imageURL = new URL(stream.thumbnail_url.replaceAll('{width}', String(width)).replaceAll('{height}', String(height)));
      if (imageURL.protocol !== 'https:' || imageURL.hostname !== 'static-cdn.jtvnw.net' || imageURL.port || imageURL.username || imageURL.password || !imageURL.pathname.startsWith('/previews-ttv/')) throw new Error();
    } catch { throw new Error('invalid_frame_url'); }
    imageURL.searchParams.set('nib', String(this.now()));
    const image = await this.fetch(imageURL, {signal, redirect: 'error'});
    if (!image.ok) throw new Error('frame_unavailable');
    const type = image.headers.get('content-type')?.split(';')[0].trim();
    if (!['image/jpeg', 'image/png'].includes(type)) { await image.body?.cancel(); throw new Error('invalid_frame'); }
    const bytes = await bounded(image, MAX_IMAGE_BYTES);
    const valid = type === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    if (!valid) throw new Error('invalid_frame');
    return {dataURL: `data:${type};base64,${bytes.toString('base64')}`, fetchedAt: this.now(), maxAgeSeconds: 300, width, height};
  }
}
