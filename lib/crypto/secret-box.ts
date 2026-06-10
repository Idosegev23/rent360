import crypto from 'crypto'

const ALGO = 'aes-256-gcm'

function key(): Buffer {
  const b64 = process.env.GOOGLE_TOKEN_ENC_KEY
  if (!b64) throw new Error('GOOGLE_TOKEN_ENC_KEY missing')
  const k = Buffer.from(b64, 'base64')
  if (k.length !== 32) throw new Error('GOOGLE_TOKEN_ENC_KEY must decode to 32 bytes')
  return k
}

/** Returns "ivB64:tagB64:dataB64". */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, key(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':')
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(':')
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('bad ciphertext format')
  const decipher = crypto.createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
}
