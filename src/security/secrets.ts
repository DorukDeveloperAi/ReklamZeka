import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EncryptedSecret = Readonly<{
  algorithm: "aes-256-gcm";
  keyVersion: number;
  iv: string;
  tag: string;
  ciphertext: string;
}>;

export class SecretConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretConfigurationError";
  }
}

export function encryptionKeyFromBase64(value: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.byteLength !== 32) throw new SecretConfigurationError("SECRET_ENCRYPTION_KEY 32 byte olmalıdır");
  return key;
}

export function encryptSecret(plaintext: string, key: Buffer, keyVersion = 1): EncryptedSecret {
  if (!plaintext) throw new SecretConfigurationError("Boş sır şifrelenemez");
  if (key.byteLength !== 32) throw new SecretConfigurationError("AES-256 anahtarı 32 byte olmalıdır");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    algorithm: "aes-256-gcm",
    keyVersion,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptSecret(secret: EncryptedSecret, key: Buffer): string {
  if (key.byteLength !== 32) throw new SecretConfigurationError("AES-256 anahtarı 32 byte olmalıdır");
  const decipher = createDecipheriv(secret.algorithm, key, Buffer.from(secret.iv, "base64"));
  decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

const ALLOWED_READ_SCOPES = new Set(["ads_read", "google_ads.readonly", "offline_access"]);

export function assertReadOnlyScopes(scopes: readonly string[]): void {
  const unsafe = scopes.filter((scope) => !ALLOWED_READ_SCOPES.has(scope));
  if (unsafe.length > 0) throw new SecretConfigurationError(`MVP için izin verilmeyen OAuth scope: ${unsafe.join(", ")}`);
  if (!scopes.some((scope) => scope === "ads_read" || scope === "google_ads.readonly")) {
    throw new SecretConfigurationError("En az bir reklam okuma scope'u zorunludur");
  }
}

export function redactSecrets(value: unknown, secrets: readonly string[]): string {
  let serialized: string;
  if (value instanceof Error) serialized = `${value.name}: ${value.message}`;
  else if (typeof value === "string") serialized = value;
  else {
    try {
      serialized = JSON.stringify(value) ?? "undefined";
    } catch {
      serialized = "[SERIALIZE_EDILEMEDI]";
    }
  }
  return secrets.filter(Boolean).reduce((current, secret) => current.split(secret).join("[REDACTED]"), serialized);
}

export function publicConnectionPayload(input: Readonly<{
  id: string;
  platform: string;
  displayName: string;
  secret: EncryptedSecret;
}>) {
  return { id: input.id, platform: input.platform, displayName: input.displayName };
}
