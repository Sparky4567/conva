import { createHash, randomBytes } from 'node:crypto';
import { account, db, deleteAccount, publicUser, type Account } from './store';

export const SESSION_SECONDS = 7 * 24 * 60 * 60;
const COOKIE = 'conva_session';
export type Session = { tokenHash: string; userId: string; expiresAt: number };
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
export function sessionFor(req: Request): Session | null {
  const token = req.headers.get('cookie')?.split(';').map(c => c.trim()).find(c => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const session = db.query('SELECT * FROM sessions WHERE tokenHash = ? AND expiresAt > ?').get(digest(token), Date.now()) as Session | null;
  return session;
}
export function validSession(tokenHash: string, userId: string): boolean {
  return !!db.query('SELECT tokenHash FROM sessions WHERE tokenHash = ? AND userId = ? AND expiresAt > ?').get(tokenHash, userId, Date.now());
}
export function trustedOrigin(req: Request): boolean {
  const expected = process.env.APP_ORIGIN || new URL(req.url).origin;
  return req.headers.get('origin') === expected;
}
function cookie(req: Request, token: string, maxAge: number) {
  const secure = (process.env.APP_ORIGIN || req.url).startsWith('https:');
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
function json(body: object, status = 200, setCookie?: string) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...(setCookie ? { 'Set-Cookie': setCookie } : {}) } });
}
function createSession(req: Request, userId: string) {
  const token = randomBytes(32).toString('hex');
  db.query('DELETE FROM sessions WHERE expiresAt <= ?').run(Date.now());
  db.query('INSERT INTO sessions VALUES (?, ?, ?)').run(digest(token), userId, Date.now() + SESSION_SECONDS * 1000);
  return cookie(req, token, SESSION_SECONDS);
}

// Bound failed/expensive attempts per IP. No forwarded headers are trusted.
const attempts = new Map<string, { count: number; until: number }>();
function limited(key: string) {
  const now = Date.now();
  for (const [ip, entry] of attempts) if (entry.until <= now) attempts.delete(ip);
  let entry = attempts.get(key);
  if (!entry) { entry = { count: 0, until: now + 15 * 60 * 1000 }; attempts.set(key, entry); }
  return ++entry.count > 20;
}
const dummyHash = Bun.password.hashSync('unused-password-for-login-timing', { algorithm: 'argon2id', memoryCost: 19456, timeCost: 2 });
async function readBody(req: Request): Promise<Record<string, unknown>> {
  if (!req.headers.get('content-type')?.startsWith('application/json')) throw new Error('Send JSON data.');
  // Stream with a bound; Content-Length alone is not reliable for chunked bodies.
  const reader = req.body?.getReader();
  if (!reader) throw new Error('Request body is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 8192) { await reader.cancel(); throw new Error('Request body is too large.'); }
    chunks.push(value);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new Error('Invalid JSON data.'); }
}
export type AuthEvents = { changed(): void; revoke(tokenHash: string): void; deleted(userId: string): void };
export async function authResponse(req: Request, ip: string, events: AuthEvents): Promise<Response | null> {
  const path = new URL(req.url).pathname;
  if (!['/api/auth/register', '/api/auth/login', '/api/auth/session', '/api/auth/logout', '/api/account'].includes(path)) return null;
  const method = path === '/api/auth/session' ? 'GET' : path === '/api/account' ? 'DELETE' : 'POST';
  if (req.method !== method) return new Response('Method not allowed', { status: 405, headers: { Allow: method } });
  if (method !== 'GET' && !trustedOrigin(req)) return json({ error: 'Request origin is not allowed.' }, 403);
  const session = sessionFor(req);
  if (path === '/api/auth/session') {
    const user = session && account(session.userId);
    return user ? json({ user: { ...publicUser(user), email: user.email } }) : json({ error: 'Please sign in.' }, 401, cookie(req, '', 0));
  }
  if (path === '/api/auth/logout') {
    if (session) { db.query('DELETE FROM sessions WHERE tokenHash = ?').run(session.tokenHash); events.revoke(session.tokenHash); }
    return json({ ok: true }, 200, cookie(req, '', 0));
  }
  if (limited(ip)) return json({ error: 'Too many attempts. Please try again in 15 minutes.' }, 429);
  if (path === '/api/account' && !session) return json({ error: 'Please sign in.' }, 401);
  let body: Record<string, unknown>;
  try { body = await readBody(req); } catch (error) { return json({ error: (error as Error).message }, 400); }
  const password = body.password;
  if (typeof password !== 'string' || password.length < 1 || password.length > 128) return json({ error: 'Password must be between 12 and 128 characters.' }, 400);
  if (path === '/api/account') {
    const user = account(session!.userId);
    if (!user || !await Bun.password.verify(password, user.passwordHash)) return json({ error: 'Incorrect password.' }, 403);
    // Recheck after asynchronous password verification: logout/deletion may have happened meanwhile.
    if (!validSession(session!.tokenHash, session!.userId)) return json({ error: 'Please sign in again.' }, 401);
    deleteAccount(user.id);
    events.deleted(user.id);
    events.changed();
    return json({ ok: true }, 200, cookie(req, '', 0));
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid email address.' }, 400);
  let user: Account | null;
  if (path === '/api/auth/register') {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length < 2 || name.length > 60) return json({ error: 'Name must be between 2 and 60 characters.' }, 400);
    if (password.length < 12) return json({ error: 'Use a password with at least 12 characters.' }, 400);
    const passwordHash = await Bun.password.hash(password, { algorithm: 'argon2id', memoryCost: 19456, timeCost: 2 });
    const id = crypto.randomUUID();
    try {
      db.query('INSERT INTO accounts VALUES (?, ?, ?, ?, ?, ?)').run(id, email, name, passwordHash, '#dbeafe', Date.now());
    } catch (error) {
      if (db.query('SELECT id FROM accounts WHERE email = ?').get(email)) return json({ error: 'An account with that email already exists.' }, 409);
      throw error;
    }
    user = account(id)!;
    events.changed();
  } else {
    user = db.query('SELECT * FROM accounts WHERE email = ?').get(email) as Account | null;
    const matches = await Bun.password.verify(password, user?.passwordHash || dummyHash);
    if (!user || !matches || !account(user.id)) return json({ error: 'Email or password is incorrect.' }, 401);
  }
  // Rotating an existing session also disconnects any sockets using that session.
  if (session) { db.query('DELETE FROM sessions WHERE tokenHash = ?').run(session.tokenHash); events.revoke(session.tokenHash); }
  return json({ user: { ...publicUser(user), email: user.email } }, path === '/api/auth/register' ? 201 : 200, createSession(req, user.id));
}
