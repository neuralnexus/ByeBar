import { generateKeyPairSync } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCrx3, publicKeyFingerprint, signerPublicKey, validateCrx3 } from '../scripts/crx3.mjs';

let privateKey;
let otherPrivateKey;
let publicKey;

beforeAll(() => {
  privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
    format: 'pem',
    type: 'pkcs8'
  });
  otherPrivateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
    format: 'pem',
    type: 'pkcs8'
  });
  publicKey = signerPublicKey(privateKey);
});

describe('deterministic CRX3 signing', () => {
  it('produces stable bytes and verifies the signer, ID, signature, and embedded ZIP', () => {
    const zip = Buffer.from('canonical zip bytes');
    const first = createCrx3(zip, privateKey);
    const second = createCrx3(zip, privateKey);
    expect(second).toEqual(first);

    const fingerprint = publicKeyFingerprint(publicKey);
    const result = validateCrx3(first, { expectedPublicKey: publicKey, expectedFingerprint: fingerprint });
    expect(result.zip).toEqual(zip);
    expect(result.fingerprint).toBe(fingerprint);
    expect(result.crxId).toBe(fingerprint.slice(0, 32));
  });

  it('rejects altered signed ZIP bytes', () => {
    const crx = createCrx3(Buffer.from('canonical zip bytes'), privateKey);
    crx[crx.length - 1] ^= 0xff;
    expect(() => validateCrx3(crx, { expectedPublicKey: publicKey })).toThrow('signature is invalid');
  });

  it('rejects a signer that differs from the configured key or fingerprint', () => {
    const crx = createCrx3(Buffer.from('canonical zip bytes'), privateKey);
    expect(() => validateCrx3(crx, { expectedPublicKey: signerPublicKey(otherPrivateKey) })).toThrow(
      'configured private key'
    );
    expect(() => validateCrx3(crx, { expectedFingerprint: '0'.repeat(64) })).toThrow(
      'fingerprint does not match'
    );
  });

  it('rejects malformed headers instead of trusting the embedded ZIP', () => {
    const crx = createCrx3(Buffer.from('canonical zip bytes'), privateKey);
    crx.writeUInt32LE(0xffff_ffff, 8);
    expect(() => validateCrx3(crx)).toThrow('header length is invalid');
  });
});
