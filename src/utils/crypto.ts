// 安全密码加密/解密工具
// 使用 AES-GCM 对称加密

import { deleteCookie, getCookie, setCookie } from './cookies';

const SECURITY_PASSWORD_COOKIE = 'hrt-security-pwd';
const SALT_PREFIX = 'hrt-tracker-security-v2-'; // 用于生成用户特定salt
const SECURITY_PASSWORD_COOKIE_DAYS = 3650;

/**
 * Per-user cookie name (F18): the security-password cookie used to be a single
 * shared blob, so account A's saved PIN could sit in the cookie during account
 * B's session (B cannot decrypt it, but it is not self-cleaning either).
 * Namespacing by username makes each account's blob independent; the old
 * shared cookie is still read once for migration and is only ever deleted
 * when it decrypts with the requesting user's key (i.e. it belongs to them).
 */
const cookieNameFor = (username: string): string =>
  `${SECURITY_PASSWORD_COOKIE}-${encodeURIComponent(username)}`;

/**
 * 从用户名派生加密密钥
 * 使用用户名作为salt的一部分，确保每个用户有不同的密钥派生
 */
async function deriveKey(username: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();

  // 使用用户名生成唯一的salt
  const userSalt = SALT_PREFIX + username;

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(username + userSalt),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(userSalt),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * 加密安全密码
 */
async function encryptPassword(password: string, username: string): Promise<string> {
  const key = await deriveKey(username);
  const encoder = new TextEncoder();
  const data = encoder.encode(password);

  // 生成随机 IV
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv,
    },
    key,
    data
  );

  // 将 IV 和加密数据组合在一起
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);

  // 转换为 Base64
  return btoa(String.fromCharCode(...combined));
}

/**
 * 解密安全密码
 */
async function decryptPassword(encryptedData: string, username: string): Promise<string | null> {
  try {
    const key = await deriveKey(username);

    // 从 Base64 解码
    const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));

    // 分离 IV 和加密数据
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv,
      },
      key,
      encrypted
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (error) {
    console.error('Failed to decrypt password:', error);
    return null;
  }
}

/**
 * 保存安全密码到 Cookie（加密，长期有效）
 * @returns true if saved successfully, false otherwise
 */
export async function saveSecurityPassword(password: string, username: string): Promise<boolean> {
  try {
    const encrypted = await encryptPassword(password, username);
    const saved = setCookie(cookieNameFor(username), encrypted, SECURITY_PASSWORD_COOKIE_DAYS);

    if (saved) {
      console.log('Security password saved to cookie successfully');
      // Best-effort migration: the PIN now lives in the per-user cookie, so
      // retire the legacy shared blob if it belonged to this user.
      try {
        const legacy = getCookie(SECURITY_PASSWORD_COOKIE);
        if (legacy && await decryptPassword(legacy, username) !== null) {
          deleteCookie(SECURITY_PASSWORD_COOKIE);
        }
      } catch { /* migration is best-effort */ }
    } else {
      console.error('Failed to save security password to cookie');
    }

    return saved;
  } catch (error) {
    console.error('Failed to save security password:', error);
    return false;
  }
}

/**
 * 从 Cookie 获取安全密码（解密）。先读按用户命名的 Cookie，再回退旧的共享
 * Cookie（命中则迁移到新命名）。
 */
export async function getSecurityPassword(username: string): Promise<string | null> {
  try {
    const named = getCookie(cookieNameFor(username));
    if (named) {
      return await decryptPassword(named, username);
    }
    const legacy = getCookie(SECURITY_PASSWORD_COOKIE);
    if (!legacy) return null;
    const decrypted = await decryptPassword(legacy, username);
    if (decrypted) {
      // Migrate so the shared blob can be retired.
      try {
        if (setCookie(cookieNameFor(username), legacy, SECURITY_PASSWORD_COOKIE_DAYS)) {
          deleteCookie(SECURITY_PASSWORD_COOKIE);
        }
      } catch { /* migration is best-effort */ }
    }
    return decrypted;
  } catch (error) {
    console.error('Failed to get security password:', error);
    return null;
  }
}

/**
 * 清除安全密码 Cookie。只清除属于该用户的命名 Cookie；旧的共享 Cookie
 * 仅当它确实属于该用户（可用其密钥解密）时才删除，避免清掉别人的数据。
 * @returns true if deleted successfully, false otherwise
 */
export async function clearSecurityPassword(username?: string): Promise<boolean> {
  try {
    let ok = true;
    if (username) {
      ok = deleteCookie(cookieNameFor(username));
      const legacy = getCookie(SECURITY_PASSWORD_COOKIE);
      if (legacy && await decryptPassword(legacy, username) !== null) {
        deleteCookie(SECURITY_PASSWORD_COOKIE);
      }
    } else {
      // No username: only the legacy shared cookie can be addressed safely.
      ok = deleteCookie(SECURITY_PASSWORD_COOKIE);
    }
    return ok;
  } catch (error) {
    console.error('Failed to clear security password cookie:', error);
    return false;
  }
}
