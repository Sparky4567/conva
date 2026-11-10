import type { ServerWebSocket } from 'bun';
import index from '../client/index.html';
import { db, users, chats, messages } from './store';
import { authResponse, sessionFor, trustedOrigin, validSession } from './auth';
import type { Message } from '../shared/types';

export type SocketData = { userId: string; tokenHash: string; expiresAt: number };
const online = new Map<string, number>();
const sockets = new Set<ServerWebSocket<SocketData>>();
const expiryTimers = new Map<ServerWebSocket<SocketData>, ReturnType<typeof setTimeout>>();
function snapshot(userId: string) {
  const visibleChats = chats().filter(c => c.members.includes(userId));
  const ids = new Set(visibleChats.map(c => c.id));
  return { type: 'init', users: users(), chats: visibleChats, messages: messages().filter(m => ids.has(m.chatId)), online: [...online.keys()] };
}
function refresh() { for (const ws of sockets) if (validSession(ws.data.tokenHash, ws.data.userId)) ws.send(JSON.stringify(snapshot(ws.data.userId))); }
function invalidate(predicate: (data: SocketData) => boolean) {
  for (const ws of sockets) if (predicate(ws.data)) { ws.send(JSON.stringify({ type: 'unauthorized' })); ws.close(4001, 'Session ended'); }
}

export const options: import('bun').ServeOptions<SocketData> = {
  port: Number(process.env.PORT || 3000),
  routes: { '/': index, '/index.html': index },
  async fetch(req, server) {
    const url = new URL(req.url);
    try {
      if (url.pathname === '/ws') {
        if (!trustedOrigin(req)) return new Response('Origin not allowed', { status: 403 });
        const session = sessionFor(req);
        if (!session) return new Response('Sign in required', { status: 401 });
        // Query-string identities are deliberately ignored. Only the cookie identifies the user.
        if (server.upgrade(req, { data: { userId: session.userId, tokenHash: session.tokenHash, expiresAt: session.expiresAt } })) return;
        return new Response('WebSocket required', { status: 400 });
      }
      const response = await authResponse(req, server.requestIP(req)?.address || 'unknown', {
        changed: refresh,
        revoke: tokenHash => invalidate(data => data.tokenHash === tokenHash),
        deleted: userId => invalidate(data => data.userId === userId),
      });
      if (response) return response;
      if (url.pathname === '/api/health') return Response.json({ ok: true });
      return new Response('Not found', { status: 404 });
    } catch (error) {
      console.error('Request failed', error);
      return Response.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
    }
  },
  websocket: {
    maxPayloadLength: 32768,
    open(ws) {
      const { userId: id, tokenHash, expiresAt } = ws.data;
      if (!validSession(tokenHash, id)) { ws.close(4001, 'Session ended'); return; }
      sockets.add(ws);
      expiryTimers.set(ws, setTimeout(() => { ws.send(JSON.stringify({ type: 'unauthorized' })); ws.close(4001, 'Session expired'); }, Math.max(0, expiresAt - Date.now())));
      ws.subscribe('all'); ws.subscribe(id);
      online.set(id, (online.get(id) || 0) + 1);
      ws.send(JSON.stringify(snapshot(id)));
      server.publish('all', JSON.stringify({ type: 'presence', online: [...online.keys()] }));
    },
    message(ws, raw) {
      if (!validSession(ws.data.tokenHash, ws.data.userId)) { ws.close(4001, 'Session ended'); return; }
      try {
        const event = JSON.parse(String(raw));
        if (!event || typeof event !== 'object') return;
        const senderId = ws.data.userId;
        if (event.type === 'message') {
          const chat = chats().find(c => c.id === event.chatId && c.members.includes(senderId));
          if (!chat || typeof event.text !== 'string' || !event.text.trim() || event.text.length > 4000) return;
          const message: Message = { id: crypto.randomUUID(), chatId: chat.id, senderId, text: event.text.trim(), createdAt: new Date().toISOString() };
          db.query('INSERT INTO messages VALUES (?, ?, ?, ?, ?)').run(message.id, message.chatId, message.senderId, message.text, message.createdAt);
          chat.members.forEach(id => server.publish(id, JSON.stringify({ type: 'message', message })));
        } else if (event.type === 'create-chat') {
          const directory = users();
          const members = [...new Set([senderId, ...(Array.isArray(event.members) ? event.members : [])])].filter(id => directory.some(u => u.id === id)) as string[];
          if (members.length < 2) return;
          const existing = chats().find(c => !c.group && members.length === 2 && c.members.length === 2 && members.every(id => c.members.includes(id)));
          if (existing) { ws.send(JSON.stringify({ type: 'chat', chat: existing })); return; }
          const chat = { id: crypto.randomUUID(), name: String(event.name || 'New group').slice(0, 80), members, group: members.length > 2 };
          db.query('INSERT INTO chats VALUES (?, ?, ?, ?)').run(chat.id, chat.name, JSON.stringify(members), Number(chat.group));
          members.forEach(id => server.publish(id, JSON.stringify({ type: 'chat', chat })));
        } else if (event.type === 'typing') {
          const chat = chats().find(c => c.id === event.chatId && c.members.includes(senderId));
          chat?.members.filter(id => id !== senderId).forEach(id => server.publish(id, JSON.stringify({ type: 'typing', chatId: chat.id, userId: senderId })));
        } else if (['offer', 'answer', 'ice', 'hangup', 'decline'].includes(event.type) && event.to !== senderId) {
          // Calling is restricted to two members of an existing direct conversation.
          if (!chats().some(c => !c.group && c.members.includes(senderId) && c.members.includes(event.to))) return;
          server.publish(event.to, JSON.stringify({ type: 'signal', signal: { type: event.type, to: event.to, from: senderId, data: event.data, video: !!event.video } }));
        }
      } catch { ws.send(JSON.stringify({ type: 'error', message: 'Could not process request.' })); }
    },
    close(ws) {
      clearTimeout(expiryTimers.get(ws)); expiryTimers.delete(ws);
      if (!sockets.delete(ws)) return;
      const id = ws.data.userId, count = (online.get(id) || 1) - 1;
      if (count) online.set(id, count); else online.delete(id);
      server.publish('all', JSON.stringify({ type: 'presence', online: [...online.keys()] }));
    },
  },
  development: process.env.NODE_ENV !== 'production' && { hmr: true, console: true },
};
let server: Pick<import('bun').Server<SocketData>, 'publish'>;
export function setPublisher(publisher: typeof server) { server = publisher; }
