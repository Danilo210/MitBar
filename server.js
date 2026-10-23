'use strict';

const express = require('express');
const { createServer } = require('node:http');
const { Server } = require('socket.io');

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self)');
  next();
});
app.use(express.static('public', { extensions: ['html'], maxAge: process.env.NODE_ENV === 'production' ? '15m' : 0 }));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  maxHttpBufferSize: 15_000,
  cors: { origin: false },
  pingTimeout: 22_000,
});

const MAX_PLAYERS = 60;
const VOICE_RADIUS = 11;
const INTERACTION_RADIUS = 8;
const FLOOR_HEIGHT = 4.8;
const players = new Map();
const pendingCalls = new Map(); // receptor -> { from, timer }
const activeCalls = new Map();  // socket id -> socket id
const reportCooldown = new Map();

const sanitizeText = (str, max = 32) => String(str || '')
  .replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
const validEmail = s => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 160;
const genderName = { masculino: 'Masculino', feminino: 'Feminino', neutro: 'Neutro' };
const allowed = {
  skin: ['#f2c8a2', '#dba97c', '#ae785a', '#865540', '#513528', '#e8b8a8'],
  hair: ['#241d25', '#66412c', '#bd8756', '#9c4d55', '#d7cab1', '#426c83'],
  outfit: ['#8d70e8', '#f17d96', '#57b5a9', '#e2a65b', '#718dc8', '#d4d1da'],
  style: ['curto', 'medio', 'longo', 'cacheado', 'raspado'],
};
function sanitizeLook(look) {
  return Object.fromEntries(Object.entries(allowed).map(([key, values]) =>
    [key, values.includes(look?.[key]) ? look[key] : values[0]]));
}
function publicPlayer(p) {
  return { id: p.id, nick: p.nick, gender: p.gender, look: p.look, x: p.x, z: p.z, floor: p.floor, rotation: p.rotation };
}
function dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
function isNear(a, b, radius = VOICE_RADIUS) {
  return a && b && a.floor === b.floor && dist(a, b) <= radius;
}
function sendStatus() { io.emit('world:count', { online: players.size }); }
function removePending(toId, reason = 'Chamada não atendida') {
  const request = pendingCalls.get(toId);
  if (!request) return;
  clearTimeout(request.timer);
  pendingCalls.delete(toId);
  io.to(request.from).emit('call:status', { status: 'ended', message: reason });
  io.to(toId).emit('call:cancel', { message: reason });
}
function endCall(id, message = 'Chamada encerrada') {
  const other = activeCalls.get(id);
  if (!other) return;
  activeCalls.delete(id);
  activeCalls.delete(other);
  io.to(id).emit('call:end', { message });
  io.to(other).emit('call:end', { message });
}

app.get('/health', (req, res) => res.json({ ok: true, online: players.size }));
app.get('/api/config', (req, res) => {
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
  if (process.env.TURN_URLS && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({
      urls: process.env.TURN_URLS.split(',').map(s => s.trim()).filter(Boolean),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }
  res.json({ iceServers, proximityRadius: VOICE_RADIUS, interactionRadius: INTERACTION_RADIUS, floorHeight: FLOOR_HEIGHT });
});

io.on('connection', socket => {
  let lastJoin = 0;
  socket.on('world:join', (payload, ack) => {
    function reject(message) { if (typeof ack === 'function') ack({ ok: false, message }); }
    if (players.has(socket.id)) return reject('Você já entrou no MitBar.');
    if (Date.now() - lastJoin < 1000) return reject('Tente novamente.');
    if (players.size >= MAX_PLAYERS) return reject('O pub atingiu a lotação. Tente novamente mais tarde.');
    const realName = sanitizeText(payload?.name, 64);
    const nick = sanitizeText(payload?.nick, 22);
    const email = typeof payload?.email === 'string' ? payload.email.trim().toLowerCase() : '';
    const age = Number(payload?.age);
    if (realName.length < 2 || nick.length < 2) return reject('Informe seu nome e um nome de personagem com ao menos 2 caracteres.');
    if (!validEmail(email)) return reject('Informe um e-mail válido.');
    if (!Number.isInteger(age) || age < 18 || age > 120) return reject('O MitBar é exclusivo para maiores de 18 anos.');
    if (!(payload?.gender in genderName)) return reject('Selecione um gênero.');
    const occupiedName = [...players.values()].some(p => p.nick.toLocaleLowerCase('pt-BR') === nick.toLocaleLowerCase('pt-BR'));
    if (occupiedName) return reject('Este nome de personagem já está em uso. Escolha outro.');

    const newPlayer = {
      id: socket.id, name: realName, email, age, // dados privados e apenas em memória enquanto conectado
      nick, gender: payload.gender, look: sanitizeLook(payload.look),
      x: 0.3 + (Math.random() - .5) * 3.0, z: 9 + (Math.random() - .5) * 3,
      floor: 0, rotation: Math.PI, lastMove: Date.now(), lastFloor: 0, lastVideoRequest: 0,
    };
    const previous = Array.from(players.values(), publicPlayer);
    lastJoin = Date.now();
    players.set(socket.id, newPlayer);
    socket.emit('world:init', { id: socket.id, you: publicPlayer(newPlayer), players: previous });
    socket.broadcast.emit('world:joined', publicPlayer(newPlayer));
    sendStatus();
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('world:move', movement => {
    const p = players.get(socket.id);
    if (!p) return;
    const now = Date.now();
    const dt = Math.min((now - p.lastMove) / 1000, 0.35);
    if (dt < 0.055) return;
    const x = Number(movement?.x);
    const z = Number(movement?.z);
    const rotation = Number(movement?.rotation);
    if (![x, z, rotation].every(Number.isFinite)) return;
    const targetX = Math.max(-18.6, Math.min(18.6, x));
    const targetZ = Math.max(-13.6, Math.min(13.6, z));
    const traveled = Math.hypot(targetX - p.x, targetZ - p.z);
    const maxStep = Math.max(.15, dt * 8.4);
    const factor = traveled > maxStep ? maxStep / traveled : 1;
    p.x += (targetX - p.x) * factor;
    p.z += (targetZ - p.z) * factor;
    p.rotation = ((rotation % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    p.lastMove = now;
    socket.broadcast.emit('world:moved', { id: p.id, x: p.x, z: p.z, floor: p.floor, rotation: p.rotation });
  });

  socket.on('world:floor', request => {
    const p = players.get(socket.id);
    const floor = Number(request?.floor);
    if (!p || !Number.isInteger(floor) || floor < 0 || floor > 2 || Math.abs(floor - p.floor) !== 1) return;
    if (Date.now() - p.lastFloor < 1300) return;
    // Elevador/escada: somente quem está próximo à entrada pode mudar de andar.
    if (Math.hypot(p.x + 16.6, p.z + 11.6) > 4.3) return;
    p.floor = floor;
    p.x = -15.4;
    p.z = -9.1;
    p.lastFloor = Date.now();
    socket.emit('world:teleported', publicPlayer(p));
    socket.broadcast.emit('world:moved', { id: p.id, x: p.x, z: p.z, floor: p.floor, rotation: p.rotation });
  });

  socket.on('rtc:signal', data => {
    const from = players.get(socket.id), to = players.get(data?.targetId);
    if (!from || !to || !data || !['voice', 'video'].includes(data.type)) return;
    if (!data.data || typeof data.data !== 'object' || JSON.stringify(data.data).length > 10_000) return;
    const allowedRTC = data.type === 'voice' ? isNear(from, to, VOICE_RADIUS + 3) : activeCalls.get(from.id) === to.id;
    if (!allowedRTC) return;
    io.to(to.id).emit('rtc:signal', { fromId: from.id, type: data.type, data: data.data });
  });

  socket.on('voice:refresh', ({ targetId } = {}) => {
    const a = players.get(socket.id), b = players.get(targetId);
    if (isNear(a, b, VOICE_RADIUS + 3)) io.to(targetId).emit('voice:refresh', { fromId: a.id });
  });

  socket.on('call:request', ({ targetId } = {}) => {
    const a = players.get(socket.id), b = players.get(targetId);
    if (!a || !b || a.id === b.id) return;
    if (!isNear(a, b, INTERACTION_RADIUS)) {
      socket.emit('call:status', { status: 'ended', message: 'Aproxime-se da pessoa para convidá-la.' }); return;
    }
    if (Date.now() - a.lastVideoRequest < 8000) {
      socket.emit('call:status', { status: 'ended', message: 'Aguarde antes de enviar outro convite.' }); return;
    }
    a.lastVideoRequest = Date.now();
    if (activeCalls.has(a.id) || activeCalls.has(b.id) || pendingCalls.has(b.id) || [...pendingCalls.values()].some(v => v.from === a.id)) {
      socket.emit('call:status', { status: 'ended', message: 'Já existe uma chamada ou convite em andamento.' }); return;
    }
    const timer = setTimeout(() => removePending(b.id, 'Convite expirado.'), 30_000);
    pendingCalls.set(b.id, { from: a.id, timer });
    io.to(b.id).emit('call:incoming', { fromId: a.id, fromName: a.nick });
    socket.emit('call:status', { status: 'ringing', message: `Chamando ${b.nick}…` });
  });

  socket.on('call:reply', ({ accept } = {}) => {
    const entry = pendingCalls.get(socket.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pendingCalls.delete(socket.id);
    if (!accept || !players.has(entry.from) || !players.has(socket.id)) {
      io.to(entry.from).emit('call:status', { status: 'ended', message: 'Convite recusado ou indisponível.' });
      return;
    }
    if (activeCalls.has(entry.from) || activeCalls.has(socket.id)) return;
    activeCalls.set(entry.from, socket.id);
    activeCalls.set(socket.id, entry.from);
    io.to(entry.from).emit('call:start', { peerId: socket.id, initiator: true });
    socket.emit('call:start', { peerId: entry.from, initiator: false });
  });

  socket.on('call:cancel', () => {
    for (const [toId, entry] of pendingCalls) {
      if (entry.from === socket.id) removePending(toId, 'Convite cancelado.');
    }
  });
  socket.on('call:end', () => endCall(socket.id));
  socket.on('user:report', ({ targetId, reason } = {}) => {
    if (!players.has(socket.id) || !players.has(targetId) || socket.id === targetId) return;
    if (Date.now() - (reportCooldown.get(socket.id) || 0) < 60_000) return;
    reportCooldown.set(socket.id, Date.now());
    // Relato simples no log da aplicação; conectar à moderação real antes do lançamento público.
    console.warn('[MITBAR_REPORT]', JSON.stringify({ when: new Date().toISOString(), reporterId: socket.id, targetId, reason: sanitizeText(reason, 160) }));
    socket.emit('user:reported');
  });
  socket.on('disconnect', () => {
    if (!players.has(socket.id)) return;
    for (const [toId, entry] of pendingCalls) {
      if (toId === socket.id || entry.from === socket.id) removePending(toId, 'Usuário desconectado.');
    }
    endCall(socket.id, 'A outra pessoa saiu da chamada.');
    players.delete(socket.id);
    reportCooldown.delete(socket.id);
    io.emit('world:left', { id: socket.id });
    sendStatus();
  });
});

const PORT = Number(process.env.PORT) || 3000;
httpServer.listen(PORT, '0.0.0.0', () => console.log(`MitBar em http://localhost:${PORT}`));
