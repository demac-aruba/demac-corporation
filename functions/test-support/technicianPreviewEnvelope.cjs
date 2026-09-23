// Encrypt temporary synthetic access/snapshots to the review session's public key.
// The private key never enters this repository or the runner.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Expected private input and encrypted output paths.');
const key = crypto.randomBytes(32), iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const data = Buffer.concat([cipher.update(fs.readFileSync(input)), cipher.final()]);
const wrapped = crypto.publicEncrypt({ key: fs.readFileSync(path.join(__dirname, 'technicianPreviewPublicKey.pub')), padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key);
fs.writeFileSync(output, JSON.stringify({ algorithm: 'RSA-OAEP-SHA256/AES-256-GCM', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), key: wrapped.toString('base64'), ciphertext: data.toString('base64') }));
