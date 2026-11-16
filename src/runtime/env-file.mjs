// Reads the project's .env file (API keys and settings) for the studio and the server.
//
// Forgiving on purpose, because it is usually edited by hand on Windows:
// - Notepad can save it as ".env.txt" (with extensions hidden, it still looks like
//   ".env"), so that name is read too.
// - UTF-8 and UTF-16 files (with or without a byte-order mark) both work.
// - Quotes, "export ", spaces around "=" and stray spaces after the value are ignored.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const ENV_FILE_NAMES = ['.env', '.env.txt'];

/** Decodes a .env file's bytes, whether it was saved as UTF-8 or UTF-16 (LE/BE). */
export function decodeEnvBytes(bytes) {
  const buffer = Buffer.from(bytes);
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  // UTF-16 LE without a BOM: every other byte is zero for plain ASCII text.
  if (buffer.length >= 4 && buffer[1] === 0 && buffer[3] === 0 && buffer[0] !== 0) return buffer.toString('utf16le');
  return buffer.toString('utf8').replace(/^﻿/, '');
}

/** KEY=value lines from a .env file (comments and blank lines skipped, quotes removed). */
export function parseEnv(text) {
  const out = {};
  for (const rawLine of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2').trim();
  }
  return out;
}

/** Loads a .env file into `env` without overriding values that are already set. */
export function loadEnvFile(file, env = process.env) {
  if (!existsSync(file)) return false;
  for (const [key, value] of Object.entries(parseEnv(decodeEnvBytes(readFileSync(file))))) {
    if (env[key] === undefined || env[key] === '') env[key] = value;
  }
  return true;
}

/** The first .env-style file that exists in `root`, or null. */
export function findEnvFile(root) {
  for (const name of ENV_FILE_NAMES) {
    const file = path.join(root, name);
    if (existsSync(file)) return file;
  }
  return null;
}

/** Loads the project's .env (or .env.txt) into `env`. Returns the file used, or null. */
export function loadProjectEnv(root, env = process.env) {
  const file = findEnvFile(root);
  if (file) loadEnvFile(file, env);
  return file;
}

/** Cleans a pasted API key: trims spaces, quotes and a leading "GEMINI_API_KEY=". */
export function cleanApiKey(value) {
  return String(value || '')
    .trim()
    .replace(/^GEMINI_API_KEY\s*=\s*/i, '')
    .replace(/^(['"])(.*)\1$/, '$2')
    .replace(/\s+/g, '');
}

/**
 * Gemini keys come in two shapes: the new Auth keys AI Studio issues today
 * ("AQ.Ab…", with dots) and the older Standard keys ("AIza" plus 35 characters).
 */
export function looksLikeGeminiKey(value) {
  const key = String(value || '');
  return /^AQ\.[0-9A-Za-z_.-]{20,}$/.test(key) || /^AIza[0-9A-Za-z_-]{35}$/.test(key);
}

/** "AIza…wxyz": enough to recognize a key without showing it. */
export function maskKey(value) {
  const key = String(value || '');
  return key.length > 10 ? `${key.slice(0, 4)}…${key.slice(-4)}` : '(set)';
}

/**
 * Saves GEMINI_API_KEY into the .env file (UTF-8), replacing an existing key line or a
 * placeholder comment, and keeping every other line.
 */
export function saveGeminiKey(file, key) {
  const lines = existsSync(file) ? decodeEnvBytes(readFileSync(file)).split(/\r?\n/) : [];
  const kept = lines.filter((line) => {
    const trimmed = line.trim();
    if (/^(?:export\s+)?GEMINI_API_KEY\s*=/.test(trimmed)) return false;
    if (/^#.*GEMINI_API_KEY=your-key/.test(trimmed)) return false;
    return true;
  });
  while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();
  kept.unshift(`GEMINI_API_KEY=${key}`);
  writeFileSync(file, `${kept.join('\n')}\n`, 'utf8');
}
