import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import type { User, Chat, Message } from '../shared/types';

mkdirSync(new URL('./data', import.meta.url), { recursive: true });
export const db = new Database(process.env.DB_PATH || new URL('./data/chat.sqlite', import.meta.url).pathname, { create: true });
db.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    passwordHash TEXT NOT NULL, color TEXT NOT NULL, createdAt INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    tokenHash TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expiresAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions(userId);
  CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, chatId TEXT, senderId TEXT, text TEXT, createdAt TEXT);
  CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, name TEXT, members TEXT, isGroup INTEGER);
  CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY);
`);

// Remove legacy seeded data once, without removing conversations made by registered users.
if (!db.query('SELECT id FROM migrations WHERE id = ?').get('remove-demo-profiles')) {
  db.transaction(() => {
    const demoIds = ['alex', 'sarah', 'james', 'emma', 'oliver'];
    for (const chat of chats()) {
      if (chat.members.some(id => demoIds.includes(id))) {
        db.query('DELETE FROM messages WHERE chatId = ?').run(chat.id);
        db.query('DELETE FROM chats WHERE id = ?').run(chat.id);
      }
    }
    for (const id of demoIds) db.query('DELETE FROM messages WHERE senderId = ?').run(id);
    db.query('INSERT INTO migrations VALUES (?)').run('remove-demo-profiles');
  })();
}

export type Account = { id: string; email: string; name: string; passwordHash: string; color: string; createdAt: number };
export function account(id: string) { return db.query('SELECT * FROM accounts WHERE id = ?').get(id) as Account | null; }
export function publicUser(row: Account): User { return { id: row.id, name: row.name, color: row.color, role: 'Conva member' }; }
export function users(): User[] { return (db.query('SELECT * FROM accounts ORDER BY name').all() as Account[]).map(publicUser); }
export function chats(): Chat[] {
  return (db.query('SELECT * FROM chats').all() as { id: string; name: string; members: string; isGroup: number }[])
    .map(c => ({ id: c.id, name: c.name, members: JSON.parse(c.members), group: !!c.isGroup }));
}
export function messages(): Message[] { return db.query('SELECT * FROM messages ORDER BY createdAt, rowid').all() as Message[]; }

export function deleteAccount(userId: string) {
  db.transaction(() => {
    // Erase authored messages everywhere. Direct conversations are removed entirely;
    // groups retain other members' messages if at least two members remain.
    db.query('DELETE FROM messages WHERE senderId = ?').run(userId);
    for (const chat of chats().filter(c => c.members.includes(userId))) {
      const members = chat.members.filter(id => id !== userId);
      if (!chat.group || members.length < 2) {
        db.query('DELETE FROM messages WHERE chatId = ?').run(chat.id);
        db.query('DELETE FROM chats WHERE id = ?').run(chat.id);
      } else {
        db.query('UPDATE chats SET members = ? WHERE id = ?').run(JSON.stringify(members), chat.id);
      }
    }
    db.query('DELETE FROM accounts WHERE id = ?').run(userId);
  })();
}
