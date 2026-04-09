import { scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const dbPath = path.join(repoRoot, 'server', 'data', 'db.json');

const identifier = (process.argv[2] || 'admin').trim().toLowerCase();
const newPassword = process.argv[3] || 'admin123';

if (!identifier || !newPassword) {
  console.error('Usage: node scripts/reset-password.mjs <identifier> <newPassword>');
  process.exit(1);
}

function hashPassword(password) {
  return scryptSync(password, 'ivy-static-salt', 64).toString('hex');
}

const raw = readFileSync(dbPath, 'utf8');
const db = JSON.parse(raw);

if (!Array.isArray(db.users)) {
  console.error('Invalid database format: users array not found.');
  process.exit(1);
}

const user = db.users.find((item) => {
  const id = String(item.id || '').toLowerCase();
  const username = String(item.username || '').toLowerCase();
  const email = String(item.email || '').toLowerCase();
  return id === identifier || username === identifier || email === identifier;
});

if (!user) {
  console.error(`No user found for identifier '${identifier}'.`);
  process.exit(1);
}

user.passwordHash = hashPassword(newPassword);
writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');

console.log(`Password reset successful for '${user.username}' (${user.id}).`);
