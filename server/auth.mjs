import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

export const digest = value => createHash('sha256').update(value).digest('hex');
export const randomToken = () => randomBytes(32).toString('hex');
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const computed = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === computed.length && timingSafeEqual(computed, expected);
}
export function cookieValue(header, name) {
  return (header || '').split(';').map(value => value.trim()).find(value => value.startsWith(name + '='))?.slice(name.length + 1);
}
export function safeUser(user) {
  return user ? { id: user.id, username: user.username, displayName: user.display_name, role: user.role } : null;
}
