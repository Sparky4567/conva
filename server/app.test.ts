import { expect, test, beforeAll } from 'bun:test';
process.env.DB_PATH = ':memory:';
const { options, setPublisher } = await import('./app');
const { db, account, users, chats, messages } = await import('./store');
const { sessionFor } = await import('./auth');
import type { CurrentUser } from '../client/api';
import type { SocketData } from './app';

const origin = 'http://localhost:3000';
const password = 'a-correct-password-123';
const published: { topic: string; event: any }[] = [];
setPublisher({ publish(topic: string, data: any) { published.push({ topic, event: JSON.parse(data) }); return 1; } });
const handler = options.websocket!;
let ipCounter = 0;
let upgraded: SocketData | undefined;
const fakeServer = {
  requestIP: () => ({ address: `test-ip-${++ipCounter}` }),
  upgrade: (_req: Request, options: { data: SocketData }) => { upgraded = options.data; return true; },
} as any;
async function request(path: string, method = 'GET', body?: object, cookie = '', requestOrigin: string | null = origin, server = fakeServer) {
  const headers: Record<string, string> = { cookie };
  if (requestOrigin) headers.origin = requestOrigin;
  if (body) headers['content-type'] = 'application/json';
  return await options.fetch!.call(server, new Request(`${origin}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), server) as Response;
}
type Identity = { user: CurrentUser; cookie: string; data: SocketData };
async function register(email: string, name = 'Test Member'): Promise<Identity> {
  const response = await request('/api/auth/register', 'POST', { email, name, password });
  expect(response.status).toBe(201);
  const { user } = await response.json();
  const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
  const session = sessionFor(new Request(origin, { headers: { cookie } }))!;
  return { user, cookie, data: { userId: user.id, tokenHash: session.tokenHash, expiresAt: session.expiresAt } };
}
function fake(data: SocketData) {
  return { data, sent: [] as any[], closed: false, subscribe() {}, send(raw: string) { this.sent.push(JSON.parse(raw)); }, close() { this.closed = true; } };
}
function message(identity: Identity, event: object) {
  published.length = 0;
  const ws = fake(identity.data);
  handler.message!(ws as any, JSON.stringify(event));
  return ws;
}
let alice: Identity, bob: Identity, carol: Identity, directId: string, groupId: string;
beforeAll(async () => {
  expect(users()).toEqual([]);
  expect(chats()).toEqual([]);
  expect(messages()).toEqual([]);
  alice = await register('ALICE@example.com', 'Alice Member');
  bob = await register('bob@example.com', 'Bob Member');
  carol = await register('carol@example.com', 'Carol Member');
});

test('registration normalizes email, hashes passwords and sets an HttpOnly session cookie', async () => {
  expect(alice.user.email).toBe('alice@example.com');
  const row = account(alice.user.id)!;
  expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);
  expect(row.passwordHash).not.toBe(password);
  expect(await Bun.password.verify(password, row.passwordHash)).toBe(true);
  expect((alice.user as any).passwordHash).toBeUndefined();
  const response = await request('/api/auth/login', 'POST', { email: 'bob@example.com', password });
  const cookie = response.headers.get('set-cookie')!;
  expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Strict'); expect(cookie).toContain('Max-Age=604800');
});
test('registration rejects duplicates and invalid input', async () => {
  expect((await request('/api/auth/register', 'POST', { name: 'Duplicate', email: 'Alice@Example.com', password })).status).toBe(409);
  for (const body of [
    { name: 'Valid Name', email: 'invalid', password },
    { name: 'X', email: 'valid@example.com', password },
    { name: 'Valid Name', email: 'valid@example.com', password: 'short' },
  ]) expect((await request('/api/auth/register', 'POST', body)).status).toBe(400);
});
test('login uses a generic error for unknown accounts and wrong passwords', async () => {
  const wrong = await request('/api/auth/login', 'POST', { email: 'alice@example.com', password: 'incorrect' });
  const unknown = await request('/api/auth/login', 'POST', { email: 'unknown@example.com', password });
  expect(wrong.status).toBe(401); expect(unknown.status).toBe(401);
  expect(await wrong.json()).toEqual(await unknown.json());
});
test('sessions restore the current account and reject forged or expired cookies', async () => {
  const response = await request('/api/auth/session', 'GET', undefined, alice.cookie);
  expect((await response.json()).user.id).toBe(alice.user.id);
  expect((await request('/api/auth/session')).status).toBe(401);
  expect((await request('/api/auth/session', 'GET', undefined, 'conva_session=' + 'a'.repeat(64))).status).toBe(401);
  const expired = await register('expired@example.com');
  db.query('UPDATE sessions SET expiresAt = 0 WHERE userId = ?').run(expired.user.id);
  expect((await request('/api/auth/session', 'GET', undefined, expired.cookie)).status).toBe(401);
});
test('HTTP writes and WebSocket upgrades reject foreign or absent origins', async () => {
  for (const untrusted of ['https://evil.example', null]) {
    expect((await request('/api/auth/logout', 'POST', undefined, alice.cookie, untrusted)).status).toBe(403);
    expect((await request('/ws', 'GET', undefined, alice.cookie, untrusted)).status).toBe(403);
  }
});
test('WebSockets require a session and ignore a spoofed query identity', async () => {
  expect((await request('/ws?userId=' + alice.user.id)).status).toBe(401);
  upgraded = undefined;
  await request('/ws?userId=' + bob.user.id, 'GET', undefined, alice.cookie);
  expect((upgraded as SocketData | undefined)?.userId).toBe(alice.user.id);
});
test('direct messages persist and only reach members; outsiders cannot read or send', () => {
  message(alice, { type: 'create-chat', members: [bob.user.id] });
  directId = published[0]!.event.chat.id;
  message(alice, { type: 'message', chatId: directId, text: 'Private message', senderId: carol.user.id });
  expect(published.map(e => e.topic)).toEqual([alice.user.id, bob.user.id]);
  expect(published[0]!.event.message.senderId).toBe(alice.user.id);
  expect(db.query('SELECT text FROM messages WHERE text = ?').get('Private message')).toBeTruthy();
  message(carol, { type: 'message', chatId: directId, text: 'Not allowed' });
  expect(published).toHaveLength(0);
  const ws = fake(carol.data);
  handler.open!(ws as any);
  const snapshot = ws.sent[0];
  expect(snapshot.chats).toHaveLength(0); expect(snapshot.messages).toHaveLength(0);
  expect(snapshot.users.every((u: any) => !('email' in u) && !('passwordHash' in u))).toBe(true);
  handler.close!(ws as any, 1000, '');
});
test('groups deduplicate real members and reject invalid members', () => {
  message(alice, { type: 'create-chat', name: 'Shared group', members: [bob.user.id, bob.user.id, carol.user.id, 'invalid'] });
  expect(published.map(e => e.topic)).toEqual([alice.user.id, bob.user.id, carol.user.id]);
  groupId = published[0]!.event.chat.id;
  message(alice, { type: 'message', chatId: groupId, text: 'Erase me' });
  message(bob, { type: 'message', chatId: groupId, text: 'Retain me' });
});
test('blank and oversized messages are ignored; call signals require a direct conversation', () => {
  for (const text of ['  ', 'a'.repeat(4001)]) { message(alice, { type: 'message', chatId: directId, text }); expect(published).toHaveLength(0); }
  message(carol, { type: 'offer', to: bob.user.id }); expect(published).toHaveLength(0);
  message(alice, { type: 'offer', from: carol.user.id, to: bob.user.id, data: { sdp: 'test' } });
  expect(published[0]!.event.signal.from).toBe(alice.user.id);
});
test('logout revokes the session, closes its live sockets, and rejects subsequent socket messages', async () => {
  const logoutUser = await register('logout@example.com');
  const ws = fake(logoutUser.data); handler.open!(ws as any);
  const response = await request('/api/auth/logout', 'POST', undefined, logoutUser.cookie);
  expect(response.status).toBe(200); expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  expect(ws.closed).toBe(true); expect(ws.sent.at(-1).type).toBe('unauthorized');
  expect((await request('/api/auth/session', 'GET', undefined, logoutUser.cookie)).status).toBe(401);
  expect(message(logoutUser, { type: 'create-chat', members: [alice.user.id] }).closed).toBe(true);
  handler.close!(ws as any, 4001, '');
});
test('password-confirmed deletion revokes all sessions, cleans conversations and updates other clients', async () => {
  const secondLogin = await request('/api/auth/login', 'POST', { email: 'alice@example.com', password });
  const secondCookie = secondLogin.headers.get('set-cookie')!.split(';')[0]!;
  const aliceSocket = fake(alice.data); handler.open!(aliceSocket as any);
  const bobSocket = fake(bob.data); handler.open!(bobSocket as any);
  expect((await request('/api/account', 'DELETE', { password: 'wrong' }, alice.cookie)).status).toBe(403);
  expect(account(alice.user.id)).toBeTruthy();
  const response = await request('/api/account', 'DELETE', { password }, alice.cookie);
  expect(response.status).toBe(200); expect(aliceSocket.closed).toBe(true);
  expect(account(alice.user.id)).toBeNull();
  expect((await request('/api/auth/session', 'GET', undefined, secondCookie)).status).toBe(401);
  expect(db.query('SELECT * FROM sessions WHERE userId = ?').all(alice.user.id)).toHaveLength(0);
  expect(messages().some(m => m.senderId === alice.user.id)).toBe(false);
  expect(chats().some(c => c.id === directId)).toBe(false);
  expect(chats().find(c => c.id === groupId)?.members).toEqual([bob.user.id, carol.user.id]);
  expect(messages().some(m => m.text === 'Retain me')).toBe(true);
  const refreshed = bobSocket.sent.at(-1);
  expect(refreshed.users.some((u: any) => u.id === alice.user.id)).toBe(false);
  expect(refreshed.chats.some((c: any) => c.id === directId)).toBe(false);
  handler.close!(aliceSocket as any, 4001, ''); handler.close!(bobSocket as any, 1000, '');
  expect((await request('/api/auth/login', 'POST', { email: 'alice@example.com', password })).status).toBe(401);
});
test('auth endpoints enforce methods, valid JSON and request limits', async () => {
  expect((await request('/api/auth/login')).status).toBe(405);
  expect((await request('/api/account', 'DELETE', { password })).status).toBe(401);
  const malformed = new Request(origin + '/api/auth/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{invalid' });
  expect((await options.fetch!.call(fakeServer, malformed, fakeServer) as Response).status).toBe(400);
  expect((await request('/api/auth/login', 'POST', { email: 'x'.repeat(9000), password })).status).toBe(400);
});
test('auth attempts are rate limited per IP', async () => {
  const sameIpServer = { ...fakeServer, requestIP: () => ({ address: 'rate-limit-test' }) };
  for (let i = 0; i < 20; i++) await request('/api/auth/login', 'POST', {}, '', origin, sameIpServer);
  expect((await request('/api/auth/login', 'POST', {}, '', origin, sameIpServer)).status).toBe(429);
});


test('live WebSocket sessions close when they expire', async () => {
  const expiring = await register('expiring-socket@example.com');
  const expiresAt = Date.now() + 30;
  db.query('UPDATE sessions SET expiresAt = ? WHERE tokenHash = ?').run(expiresAt, expiring.data.tokenHash);
  const ws = fake({ ...expiring.data, expiresAt });
  handler.open!(ws as any);
  await Bun.sleep(50);
  expect(ws.closed).toBe(true);
  expect(ws.sent.at(-1).type).toBe('unauthorized');
  expect(message(expiring, { type: 'create-chat', members: [bob.user.id] }).closed).toBe(true);
  handler.close!(ws as any, 4001, '');
});

test('HTTPS deployment uses Secure cookies and the configured public origin', async () => {
  process.env.APP_ORIGIN = 'https://chat.example.com';
  try {
    const response = await request('/api/auth/login', 'POST', { email: 'bob@example.com', password }, '', 'https://chat.example.com');
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('; Secure');
    expect((await request('/api/auth/logout', 'POST', undefined, bob.cookie)).status).toBe(403);
  } finally { delete process.env.APP_ORIGIN; }
});
