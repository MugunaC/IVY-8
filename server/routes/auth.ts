import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import type { Db, StoredUser } from '../db.js';
import { findUserByIdentifier, insertUser, listUsers, newId } from '../db.js';
import { BODY_LIMIT_AUTH } from '../config.js';
import { hashPassword, verifyPassword } from '../lib/auth.js';
import { parseBody, sendJson } from '../lib/http.js';

function sanitizeUser(user: StoredUser) {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}

export async function handleAuthRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  _url: URL,
  db: Db
) {
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    const body = await parseBody<{ identifier?: string; password?: string }>(req, BODY_LIMIT_AUTH);
    const identifier = (body.identifier || '').trim();
    const password = body.password || '';
    if (!identifier || !password) {
      sendJson(res, 400, { error: 'Identifier and password are required.' });
      return true;
    }
    const user = findUserByIdentifier(db, identifier);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      sendJson(res, 401, { error: 'Invalid credentials.' });
      return true;
    }
    sendJson(res, 200, { user: sanitizeUser(user) });
    return true;
  }

  if (pathname === '/api/auth/register' && req.method === 'POST') {
    const body = await parseBody<{ username?: string; email?: string; password?: string }>(
      req,
      BODY_LIMIT_AUTH
    );
    const username = (body.username || '').trim();
    const email = (body.email || '').trim();
    const password = body.password || '';

    if (!username || !email || !password) {
      sendJson(res, 400, { error: 'Username, email, and password are required.' });
      return true;
    }
    if (password.length < 8) {
      sendJson(res, 400, { error: 'Password must be at least 8 characters.' });
      return true;
    }

    const normalizedEmail = email.toLowerCase();
    const normalizedUsername = username.toLowerCase();
    const users = listUsers(db);
    const exists = users.some(
      (item) =>
        item.username.toLowerCase() === normalizedUsername ||
        (item.email || '').toLowerCase() === normalizedEmail
    );
    if (exists) {
      sendJson(res, 409, { error: 'Username or email already exists.' });
      return true;
    }

    const user: StoredUser = {
      id: newId('user'),
      username,
      email,
      role: 'user',
      createdAt: new Date().toISOString(),
      passwordHash: hashPassword(password),
    };
    insertUser(db, user);
    sendJson(res, 201, { user: sanitizeUser(user) });
    return true;
  }

  return false;
}
