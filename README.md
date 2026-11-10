# Skype Connect

A Skype-inspired messaging app built with React 19, TypeScript, Bun WebSockets, SQLite, and WebRTC.

Licensed under the [MIT License](LICENSE).

## Run

With Bun installed, run these commands from the project folder:

```sh
bun install
bun dev
```

Open **http://localhost:3000**. Bun serves both the React client and the backend, so only one process is needed. Leave the terminal running; press **Ctrl+C** to stop the server.

To use another port:

```sh
PORT=4000 bun dev
```

Then open **http://localhost:4000**.

To run in production mode:

```sh
bun start
```

There are no preconfigured accounts or seeded conversations. Existing demo conversations from the original version are removed automatically on first startup.

## Use the app

1. Click **Create an account**. Enter your name, email address, and a password of at least 12 characters. If you already have an account, choose **Sign in**.
2. To try messaging locally, register a second account in a **different browser or private window**. Tabs in the same browser share the login session.
3. Open **Contacts**, select the other registered member, and send a message. Press **Enter** to send or **Shift+Enter** to add a new line.
4. Use **New conversation** to select members and create a group. You can enter a group name before starting the conversation.
5. For an audio or video call, open a direct conversation with an online member and click the phone or camera button. Allow microphone/camera access, then accept the incoming call in the other browser. Headphones help prevent feedback. Calls require **localhost or HTTPS**.
6. Click your avatar or **Settings** to sign out or delete your account. Deletion requires your current password and explicit confirmation and cannot be undone.

Accounts and messages persist in `server/data/chat.sqlite`, including after restarting the server. Your session also survives page reloads until it expires or you sign out.

## Accounts and authentication

- Registration requires a name, email address, and password of 12–128 characters. Email addresses are normalized and unique.
- Passwords are hashed with Argon2id. Password hashes and email addresses are never included in the member directory.
- Sessions last seven days and survive reloads and server restarts. Random session tokens are stored in HttpOnly, SameSite=Strict cookies; only token hashes are stored in SQLite.
- WebSockets authenticate using the session cookie. Client-supplied user IDs cannot select an identity. Sessions are checked on upgrade and every incoming event, with live connections closed at expiry or revocation.
- Sign out through the avatar or Settings button. This revokes the current session and closes its live connections.
- Account deletion requires the current password and an explicit confirmation. It deletes all account sessions, authored messages, and direct conversations, removes group membership, and deletes groups with fewer than two remaining members. Remaining group members retain their own messages. Connected clients refresh automatically.
- Mutating requests and WebSocket upgrades require a matching Origin. Authentication attempts are limited to 20 per 15 minutes per IP in this single-process example.

Behind an HTTPS reverse proxy, set the public origin explicitly so origin checks and Secure cookies match the deployment:

```sh
APP_ORIGIN=https://chat.example.com bun start
```

The default expected origin is the request URL's origin. Forwarded headers are not trusted. The reverse proxy must support WebSocket upgrades. Keep the app on HTTPS outside localhost.

## Features

- Persistent direct and group conversations, search, emoji, typing indicators, and live online status.
- Create conversations and groups; inspect conversation members.
- Audio and video calls with accept, decline, microphone mute, camera toggle, and hang up.
- Responsive interface and WebSocket reconnection with history resynchronization.

## Structure and verification

- `client/` — React UI, account forms, HTTP client, styles, and browser WebRTC connection.
- `server/` — Bun HTTP/WebSocket handlers, authentication, SQLite persistence, and integration tests.
- `shared/` — common TypeScript models.
- `server/data/chat.sqlite` — generated local database, excluded from version control. Override its path with `DB_PATH`.

```sh
bun run typecheck
bun test
bun run build
bun start
```

Tests exercise HTTP handlers and WebSocket events against an isolated in-memory database. `build` exports the browser assets into `dist/`. `start` runs Bun's production server, which serves the client HTML entry and bundles its assets alongside the API and WebSocket service on the same origin.

## Scope

Email verification and password recovery are not implemented; registration does not prove ownership of an email address. Messages are not end-to-end encrypted. The member directory lists registered names, not email addresses. Deletion applies to the live SQLite database; deployment backups require their own retention policy.

Calls require browser media permissions and localhost or HTTPS. The example uses a public STUN server; reliable calling across restrictive networks requires a TURN server. Calls are between two online members in a direct conversation. Group calls, attachments, and offline call notifications are not implemented. Google Fonts is optional; system fonts are used when unavailable.
