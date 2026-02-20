import fs from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const KEY_ENV_NAME = "DASHBOARD_SECRETS_KEY";
const KEY_FILE_PATH = path.resolve(process.cwd(), "data", ".secrets-key");
const ENCRYPTION_PREFIX = "enc:v1:";
const CIPHER_ALGO = "aes-256-gcm";
const IV_BYTES = 12;

let cachedKey: Buffer | null = null;

function toBase64(value: Buffer): string {
  return value.toString("base64");
}

function fromBase64(value: string): Buffer {
  return Buffer.from(value, "base64");
}

function normalizeKeyMaterial(raw: string): Buffer {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return createHash("sha256").update(trimmed, "utf8").digest();
  }

  const prefixedBase64 = trimmed.match(/^base64:(.+)$/i);
  if (prefixedBase64?.[1]) {
    const decoded = Buffer.from(prefixedBase64[1].trim(), "base64");
    if (decoded.length > 0) {
      return decoded.length === 32 ? decoded : createHash("sha256").update(decoded).digest();
    }
  }

  const prefixedHex = trimmed.match(/^hex:(.+)$/i);
  if (prefixedHex?.[1]) {
    const decoded = Buffer.from(prefixedHex[1].trim(), "hex");
    if (decoded.length > 0) {
      return decoded.length === 32 ? decoded : createHash("sha256").update(decoded).digest();
    }
  }

  const base64Decoded = Buffer.from(trimmed, "base64");
  if (base64Decoded.length > 0 && toBase64(base64Decoded).replace(/=+$/g, "") === trimmed.replace(/=+$/g, "")) {
    return base64Decoded.length === 32 ? base64Decoded : createHash("sha256").update(base64Decoded).digest();
  }

  const utf8 = Buffer.from(trimmed, "utf8");
  return utf8.length === 32 ? utf8 : createHash("sha256").update(utf8).digest();
}

function ensureKeyFile(): Buffer {
  const dirPath = path.dirname(KEY_FILE_PATH);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }

  if (!fs.existsSync(KEY_FILE_PATH)) {
    const generated = randomBytes(32);
    fs.writeFileSync(KEY_FILE_PATH, toBase64(generated), {
      encoding: "utf8",
      mode: 0o600
    });
    return generated;
  }

  const raw = fs.readFileSync(KEY_FILE_PATH, "utf8");
  return normalizeKeyMaterial(raw);
}

function getSecretsKey(): Buffer {
  if (cachedKey) {
    return cachedKey;
  }

  const envKey = (process.env[KEY_ENV_NAME] ?? "").trim();
  cachedKey = envKey.length > 0 ? normalizeKeyMaterial(envKey) : ensureKeyFile();
  return cachedKey;
}

export function encryptSecret(value: string): string {
  if (value.length === 0) {
    return value;
  }

  if (value.startsWith(ENCRYPTION_PREFIX)) {
    return value;
  }

  const key = getSecretsKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ENCRYPTION_PREFIX}${toBase64(iv)}.${toBase64(tag)}.${toBase64(encrypted)}`;
}

export function decryptSecret(value: string): string {
  if (!value.startsWith(ENCRYPTION_PREFIX)) {
    return value;
  }

  const payload = value.slice(ENCRYPTION_PREFIX.length);
  const parts = payload.split(".");
  if (parts.length !== 3) {
    return value;
  }

  try {
    const [ivRaw, tagRaw, encryptedRaw] = parts;
    const iv = fromBase64(ivRaw);
    const tag = fromBase64(tagRaw);
    const encrypted = fromBase64(encryptedRaw);

    const decipher = createDecipheriv(CIPHER_ALGO, getSecretsKey(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return value;
  }
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(ENCRYPTION_PREFIX);
}
