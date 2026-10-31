import WebSocket from 'ws';

export function parseIRC(line, channel) {
  const match = /^(?:@([^ ]+) )?:([^! ]+)(?:![^ ]+)? PRIVMSG #([^ ]+) :(.*)$/.exec(line);
  if (!match || match[3] !== channel) return null;
  const tags = Object.fromEntries((match[1] || '').split(';').map(pair => { const at = pair.indexOf('='); return at < 0 ? [pair, ''] : [pair.slice(0, at), pair.slice(at + 1)]; }));
  return { text: match[4], userId: tags['user-id'] || match[2], username: match[2],
    displayName: tags['display-name'] || match[2],
    authorized: tags.mod === '1' || /(?:^|,)broadcaster\/1(?:,|$)/.test(tags.badges || ''),
  };
}
export class Twitch {
  constructor({ config, onMessage, onConnected, createSocket = url => new WebSocket(url, { handshakeTimeout: 10000 }),
    now = Date.now, schedule = setTimeout, unschedule = clearTimeout,
    heartbeatMs = 20000, pongTimeoutMs = 10000, joinTimeoutMs = 15000, retryMs = 5000 }) {
    Object.assign(this, { config, onMessage, onConnected, createSocket, now, schedule, unschedule, heartbeatMs, pongTimeoutMs, joinTimeoutMs, retryMs });
    this.socket = null; this.timer = null; this.closed = false; this.connected = false;
    this.heartbeatTimer = null; this.pongTimer = null; this.joinTimer = null; this.pendingPong = null;
    this.phase = config.demo || !config.channel ? 'disabled' : 'idle';
    this.stats = { attempts: 0, receivedMessages: 0, acceptedMessages: 0, rejectedMessages: 0, handlerErrors: 0,
      parseFailures: 0, probes: 0, connectedAt: null, lastFrameAt: null, lastPongAt: null, lastMessageAt: null, lastError: null };
  }
  later(callback, ms) { const timer = this.schedule(callback, ms); timer?.unref?.(); return timer; }
  cancel(name) { if (this[name] !== null) this.unschedule(this[name]); this[name] = null; }
  setConnected(value) {
    if (this.connected === value) return;
    this.connected = value; this.onConnected(value);
  }
  clearConnectionTimers() {
    for (const name of ['heartbeatTimer', 'pongTimer', 'joinTimer']) this.cancel(name);
    this.pendingPong = null;
  }
  reconnect() {
    if (this.closed || this.timer !== null) return;
    this.phase = 'reconnecting';
    this.timer = this.later(() => { this.timer = null; this.connect(); }, this.retryMs);
  }
  drop(socket, reason) {
    if (this.socket !== socket) return;
    // Invalidate first: delayed close/error/data from the old socket cannot affect its successor.
    this.socket = null; this.clearConnectionTimers(); this.stats.lastError = reason;
    this.setConnected(false);
    try { if (typeof socket.terminate === 'function') socket.terminate(); else socket.close(); } catch { /* Already closed. */ }
    this.reconnect();
  }
  heartbeat(socket) {
    this.heartbeatTimer = this.later(() => {
      this.heartbeatTimer = null;
      if (this.socket !== socket || this.closed) return;
      const nonce = Buffer.from(`${this.stats.attempts}:${++this.stats.probes}`);
      this.pendingPong = nonce;
      this.pongTimer = this.later(() => { this.pongTimer = null; this.drop(socket, 'heartbeat_timeout'); }, this.pongTimeoutMs);
      try { socket.ping(nonce); } catch { this.drop(socket, 'connection_failed'); }
    }, this.heartbeatMs);
  }
  connect() {
    if (this.config.demo || !this.config.channel || this.closed || this.socket) return;
    this.cancel('timer'); this.phase = 'connecting'; this.stats.attempts++;
    let socket;
    try { socket = this.createSocket('wss://irc-ws.chat.twitch.tv:443'); }
    catch { this.stats.lastError = 'connection_failed'; this.reconnect(); return; }
    this.socket = socket;
    const current = () => this.socket === socket && !this.closed;
    const nickname = 'justinfan' + Math.floor(10000 + Math.random() * 89999);
    socket.on('open', () => {
      if (!current()) return;
      this.phase = 'joining';
      this.joinTimer = this.later(() => { this.joinTimer = null; this.drop(socket, 'join_timeout'); }, this.joinTimeoutMs);
      try {
        socket.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
        socket.send('NICK ' + nickname); socket.send('JOIN #' + this.config.channel);
        this.heartbeat(socket);
      } catch { this.drop(socket, 'connection_failed'); }
    });
    socket.on('pong', payload => {
      if (!current() || !this.pendingPong || !Buffer.from(payload).equals(this.pendingPong)) return;
      this.stats.lastPongAt = this.now(); this.pendingPong = null; this.cancel('pongTimer'); this.heartbeat(socket);
    });
    socket.on('message', bytes => {
      if (!current()) return;
      this.stats.lastFrameAt = this.now();
      for (const line of bytes.toString().split('\r\n')) {
        if (!current()) break;
        const envelope = /^(?:@[^ ]+ )?(?::([^ ]+) )?([A-Z]+|\d{3})(?: (.*))?$/.exec(line);
        if (!envelope) continue;
        const [, prefix = '', command, parameters = ''] = envelope;
        const channel = parameters.split(' ')[0];
        if (command === 'PING') {
          try { socket.send('PONG ' + parameters); } catch { this.drop(socket, 'connection_failed'); }
          continue;
        }
        const ownJoin = command === 'JOIN' && prefix.split('!')[0] === nickname && channel === '#' + this.config.channel;
        const roomState = command === 'ROOMSTATE' && prefix === 'tmi.twitch.tv' && channel === '#' + this.config.channel;
        const namesComplete = command === '366' && channel === nickname && parameters.split(' ')[1] === '#' + this.config.channel;
        if (ownJoin || roomState || namesComplete) {
          this.cancel('joinTimer'); this.phase = 'joined'; this.stats.lastError = null;
          if (!this.connected) this.stats.connectedAt = this.now();
          this.setConnected(true);
        }
        if (command === 'RECONNECT' && prefix === 'tmi.twitch.tv') { this.drop(socket, 'server_reconnect'); continue; }
        if (command === 'NOTICE' && /Login authentication failed|Improperly formatted auth/.test(parameters)) { this.drop(socket, 'login_failed'); continue; }
        if (command === 'PRIVMSG' && channel === '#' + this.config.channel) {
          this.stats.receivedMessages++; this.stats.lastMessageAt = this.now();
          const message = parseIRC(line, this.config.channel);
          if (!message) { this.stats.parseFailures++; continue; }
          try {
            if (this.onMessage(message) === false) this.stats.rejectedMessages++;
            else this.stats.acceptedMessages++;
          } catch { this.stats.handlerErrors++; this.stats.lastError = 'handler_failed'; }
        }
      }
    });
    socket.on('error', () => this.drop(socket, 'connection_failed'));
    socket.on('close', () => this.drop(socket, 'socket_closed'));
  }
  snapshot() { return { channel: this.config.channel, connected: this.connected, phase: this.phase, ...this.stats }; }
  stop() {
    this.closed = true; this.phase = 'stopped'; this.cancel('timer'); this.clearConnectionTimers();
    const socket = this.socket; this.socket = null; this.setConnected(false);
    try { if (socket?.terminate) socket.terminate(); else socket?.close(); } catch { /* Already closed. */ }
  }
}
