import { constants, createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

const MAGIC = Buffer.from('Cr24', 'ascii');
const VERSION = 3;
const SIGNATURE_CONTEXT = Buffer.from('CRX3 SignedData\0', 'binary');

function encodeVarint(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid protobuf integer');
  const bytes = [];
  let remaining = value;
  do {
    let byte = remaining % 128;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0);
  return Buffer.from(bytes);
}

function encodeBytes(field, value) {
  const bytes = Buffer.from(value);
  return Buffer.concat([encodeVarint(field * 8 + 2), encodeVarint(bytes.length), bytes]);
}

function decodeVarint(buffer, start) {
  let value = 0;
  let multiplier = 1;
  let offset = start;
  for (let count = 0; count < 10; count += 1) {
    if (offset >= buffer.length) throw new Error('truncated CRX3 protobuf integer');
    const byte = buffer[offset];
    offset += 1;
    value += (byte & 0x7f) * multiplier;
    if (!Number.isSafeInteger(value)) throw new Error('CRX3 protobuf integer is too large');
    if ((byte & 0x80) === 0) return { value, offset };
    multiplier *= 128;
  }
  throw new Error('CRX3 protobuf integer is invalid');
}

function parseMessage(buffer, label) {
  const fields = [];
  let offset = 0;
  while (offset < buffer.length) {
    const key = decodeVarint(buffer, offset);
    offset = key.offset;
    const field = Math.floor(key.value / 8);
    const wireType = key.value % 8;
    if (field <= 0 || wireType !== 2) throw new Error(`${label} contains an unsupported field`);
    const length = decodeVarint(buffer, offset);
    offset = length.offset;
    const end = offset + length.value;
    if (end > buffer.length) throw new Error(`${label} contains a truncated field`);
    fields.push({ field, value: buffer.subarray(offset, end) });
    offset = end;
  }
  return fields;
}

function oneField(fields, field, label) {
  const matches = fields.filter((entry) => entry.field === field);
  if (matches.length !== 1) throw new Error(`${label} must contain exactly one field ${field}`);
  return matches[0].value;
}

function signatureInput(signedHeaderData, zip) {
  const length = Buffer.alloc(4);
  length.writeUInt32LE(signedHeaderData.length);
  return Buffer.concat([SIGNATURE_CONTEXT, length, signedHeaderData, zip]);
}

export function signerPublicKey(privateKeyInput) {
  const privateKey = createPrivateKey(privateKeyInput);
  if (privateKey.asymmetricKeyType !== 'rsa') throw new Error('CRX3 signing key must be RSA');
  return Buffer.from(createPublicKey(privateKey).export({ format: 'der', type: 'spki' }));
}

export function publicKeyFingerprint(publicKey) {
  return createHash('sha256').update(publicKey).digest('hex');
}

export function createCrx3(zipInput, privateKeyInput) {
  const zip = Buffer.from(zipInput);
  const privateKey = createPrivateKey(privateKeyInput);
  if (privateKey.asymmetricKeyType !== 'rsa') throw new Error('CRX3 signing key must be RSA');
  const publicKey = signerPublicKey(privateKeyInput);
  const crxId = createHash('sha256').update(publicKey).digest().subarray(0, 16);
  const signedHeaderData = encodeBytes(1, crxId);
  const signature = sign('sha256', signatureInput(signedHeaderData, zip), {
    key: privateKey,
    padding: constants.RSA_PKCS1_PADDING
  });
  const proof = Buffer.concat([encodeBytes(1, publicKey), encodeBytes(2, signature)]);
  const header = Buffer.concat([encodeBytes(2, proof), encodeBytes(10_000, signedHeaderData)]);
  const prefix = Buffer.alloc(12);
  MAGIC.copy(prefix);
  prefix.writeUInt32LE(VERSION, 4);
  prefix.writeUInt32LE(header.length, 8);
  return Buffer.concat([prefix, header, zip]);
}

export function validateCrx3(crxInput, { expectedPublicKey = null, expectedFingerprint = '' } = {}) {
  const crx = Buffer.from(crxInput);
  if (crx.length <= 12 || !crx.subarray(0, 4).equals(MAGIC) || crx.readUInt32LE(4) !== VERSION) {
    throw new Error('output is not a valid CRX3 file');
  }
  const headerLength = crx.readUInt32LE(8);
  const zipOffset = 12 + headerLength;
  if (headerLength === 0 || zipOffset >= crx.length) throw new Error('CRX3 header length is invalid');

  const header = crx.subarray(12, zipOffset);
  const zip = crx.subarray(zipOffset);
  const headerFields = parseMessage(header, 'CRX3 header');
  if (headerFields.some((entry) => entry.field !== 2 && entry.field !== 10_000)) {
    throw new Error('CRX3 header contains an unexpected field');
  }
  const proof = oneField(headerFields, 2, 'CRX3 header');
  const signedHeaderData = oneField(headerFields, 10_000, 'CRX3 header');
  const proofFields = parseMessage(proof, 'CRX3 proof');
  if (proofFields.some((entry) => entry.field !== 1 && entry.field !== 2)) {
    throw new Error('CRX3 proof contains an unexpected field');
  }
  const publicKey = oneField(proofFields, 1, 'CRX3 proof');
  const signature = oneField(proofFields, 2, 'CRX3 proof');
  const signedFields = parseMessage(signedHeaderData, 'CRX3 signed header');
  if (signedFields.some((entry) => entry.field !== 1)) {
    throw new Error('CRX3 signed header contains an unexpected field');
  }
  const crxId = oneField(signedFields, 1, 'CRX3 signed header');
  const expectedCrxId = createHash('sha256').update(publicKey).digest().subarray(0, 16);
  if (crxId.length !== 16 || !crxId.equals(expectedCrxId)) throw new Error('CRX3 ID does not match signer');

  let publicKeyObject;
  try {
    publicKeyObject = createPublicKey({ key: publicKey, format: 'der', type: 'spki' });
  } catch {
    throw new Error('CRX3 public key is invalid');
  }
  if (publicKeyObject.asymmetricKeyType !== 'rsa') throw new Error('CRX3 signer must be RSA');
  if (
    !verify(
      'sha256',
      signatureInput(signedHeaderData, zip),
      {
        key: publicKeyObject,
        padding: constants.RSA_PKCS1_PADDING
      },
      signature
    )
  ) {
    throw new Error('CRX3 signature is invalid');
  }
  if (expectedPublicKey && !publicKey.equals(Buffer.from(expectedPublicKey))) {
    throw new Error('CRX3 signer does not match the configured private key');
  }
  const fingerprint = publicKeyFingerprint(publicKey);
  if (expectedFingerprint) {
    const normalized = String(expectedFingerprint).trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error('expected CRX3 fingerprint is invalid');
    if (fingerprint !== normalized) throw new Error('CRX3 signer fingerprint does not match');
  }
  return { crxId: crxId.toString('hex'), fingerprint, publicKey, zip };
}
