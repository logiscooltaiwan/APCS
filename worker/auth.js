const SESSION_MS = 12 * 3600 * 1000;

const b64urlEncode = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
const importKey = (secret) =>
  crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

export async function makeAdminToken(secret) {
  const exp = Date.now() + SESSION_MS;
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`admin.${exp}`));
  return `${exp}.${b64urlEncode(sig)}`;
}

export async function verifyAdminToken(token, secret) {
  if (!token) return false;
  const i = token.indexOf('.');
  if (i < 0) return false;
  const expStr = token.slice(0, i);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  let sigBytes;
  try { sigBytes = b64urlDecode(token.slice(i + 1)); } catch { return false; }
  const key = await importKey(secret);
  return crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(`admin.${expStr}`));
}

export { SESSION_MS };
