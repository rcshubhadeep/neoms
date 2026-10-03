import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
function masterKey() {
  const value = process.env.LLM_ENCRYPTION_KEY;
  if (!value || !/^[0-9a-f]{64}$/i.test(value))
    throw new Error(
      'Configure LLM_ENCRYPTION_KEY as 64 hexadecimal characters on the API and worker',
    );
  return Buffer.from(value, 'hex');
}
export function sealKey(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    data.toString('base64'),
  ].join('.');
}
export function openKey(value: string) {
  const [version, iv, tag, data] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Invalid encrypted credential');
  const cipher = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(iv, 'base64'));
  cipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([cipher.update(Buffer.from(data, 'base64')), cipher.final()]).toString(
    'utf8',
  );
}
