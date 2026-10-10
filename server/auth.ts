import crypto from 'node:crypto';
import type {FastifyReply, FastifyRequest} from 'fastify';
import {env} from './env.js';
import {sessions} from './store.js';

export const COOKIE = 'tw_session';
/** A session lasts a month and renews itself once half of it is gone: an admin who comes back keeps it. */
const TTL_MS = 30 * 24 * 3600_000;

/** A session is kept bound to the password: a new ADMIN_PASSWORD ends every session made with the old one. */
const bound = (token: string) => crypto.createHmac('sha256', env.adminPassword).update(token).digest('base64url');

/** Failed logins per address in the last minute: five, then a wait. */
const failures = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_FAILURES = 5;

const digest = (s: string) => crypto.createHash('sha256').update(s).digest();

export function tooManyAttempts(ip: string): boolean {
  const recent = (failures.get(ip) ?? []).filter(t => Date.now() - t < WINDOW_MS);
  failures.set(ip, recent);
  return recent.length >= MAX_FAILURES;
}

/** Checks the password in constant time; returns a new session token or null. */
export function login(ip: string, password: string): string | null {
  if (!crypto.timingSafeEqual(digest(password), digest(env.adminPassword))) {
    failures.set(ip, [...(failures.get(ip) ?? []), Date.now()]);
    return null;
  }
  failures.delete(ip);
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(bound(token), Date.now() + TTL_MS);
  return token;
}

export function logout(token: string | undefined) {
  if (token) sessions.drop(bound(token));
}

export function isAuthed(req: FastifyRequest): boolean {
  const token = req.cookies[COOKIE];
  return !!token && sessions.expires(bound(token)) > 0;
}

export const cookieOptions = {
  path: '/',
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: env.publicUrl.startsWith('https://'),
  maxAge: TTL_MS / 1000,
};

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[COOKIE];
  const until = token ? sessions.expires(bound(token)) : 0;
  if (!until) return reply.code(401).send({error: 'Нужно войти'});
  // Past half its life the session and the cookie start a new month.
  if (until - Date.now() < TTL_MS / 2) {
    sessions.set(bound(token!), Date.now() + TTL_MS);
    reply.setCookie(COOKIE, token!, cookieOptions);
  }
}
