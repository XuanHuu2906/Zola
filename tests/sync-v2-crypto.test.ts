import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

// `electron/` biên dịch sang CommonJS nên import nội bộ ghi `./x.js`; chạy thẳng
// `.ts` thì đuôi đó không tồn tại. Cùng hook với các test protocol khác.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && specifier.endsWith('.js')) {
      try {
        return nextResolve(specifier.replace(/\.js$/, '.ts'), context);
      } catch {
        // Không có bản `.ts`: giữ nguyên đường dẫn gốc.
      }
    }
    return nextResolve(specifier, context);
  },
});

const { SyncV2Crypto, SyncCryptoError } = await import('../electron/protocol/sync-v2-crypto.ts');

/**
 * Binding WASM của Sync V2 — kiểm chứng trên **wasm thật** của bản Zalo đang cài.
 *
 * Test này không kiểm tra mạng, không kiểm tra máy chủ. Nó trả lời một câu hẹp
 * nhưng quyết định: binding viết tay có khớp ABI của wasm không? Nếu sai một
 * thứ tự tham số hay một ô `retptr`, mọi bước sau (metadata, gói tin) sẽ hỏng
 * bằng `aead::Error` — một thông báo không nói được chỗ nào sai. Vòng
 * mã-hoá/giải-mã ở đây khoá đúng những thứ đó lại.
 *
 * Wasm nằm ở `assets/zproto/`. File đó là **bản sao nguyên văn** từ bộ cài
 * Zalo (`AppDir/app/pc-dist/libs/`), sha256 in trong test cuối.
 */
const WASM_PATH = new URL('../assets/zproto/libzproto_wasm_bg.5ea0fb2c9af4a45bc7882b71307b6f83.wasm', import.meta.url);

const bytes = new Uint8Array(readFileSync(WASM_PATH));

const encoder = new TextEncoder();

/** Nạp một lần: instantiate wasm tốn vài chục ms, không cần lặp cho từng test. */
const cryptoPromise = SyncV2Crypto.load(bytes);

test('wasm của Zalo nạp được trong Node mà không cần fetch', async () => {
  const crypto = await cryptoPromise;
  assert.ok(crypto instanceof SyncV2Crypto);
});

test('cặp khoá ed25519 có kích thước đúng và không lặp', async () => {
  const crypto = await cryptoPromise;
  const first = crypto.generateKeyPair();
  const second = crypto.generateKeyPair();
  assert.equal(first.publicKey.length, 33, 'ed25519 công khai: 33 byte (có tiền tố 0x04)');
  assert.equal(first.privateKey.length, 32, 'ed25519 riêng: 32 byte');
  assert.notDeepEqual(first.publicKey, second.publicKey);
});

test('khoá công khai suy lại từ khoá riêng khớp cặp đã sinh', async () => {
  const crypto = await cryptoPromise;
  const pair = crypto.generateKeyPair();
  assert.deepEqual(crypto.derivePublicKey(pair.privateKey), pair.publicKey);
});

test('metadata: điện thoại mã hoá, PC giải được, bản ghi phiên khớp nhau', async () => {
  const crypto = await cryptoPromise;
  // PC: khoá định danh (sống lâu) + khoá tạm (mỗi phiên).
  const pcIdentity = crypto.generateKeyPair();
  const pcEphemeral = crypto.generateKeyPair();
  // Điện thoại: khoá định danh của nó.
  const phoneIdentity = crypto.generateKeyPair();

  const metaPlaintext = encoder.encode(JSON.stringify({ partitions: ['oneone/123'] }));

  const sealed = crypto.createMetadataCipher(
    metaPlaintext,
    phoneIdentity.publicKey, phoneIdentity.privateKey,
    pcIdentity.publicKey, pcEphemeral.publicKey,
  );

  assert.ok(sealed.ciphertext.length > 0);
  assert.equal(sealed.receiverIdentity.length, 33, 'danh tính người nhận là khoá công khai ed25519');

  const opened = crypto.decryptMetadata(
    sealed.ciphertext,
    pcIdentity.publicKey, pcIdentity.privateKey, pcEphemeral.privateKey,
  );

  assert.deepEqual(opened.plaintext, metaPlaintext);
  assert.deepEqual(opened.senderIdentity, phoneIdentity.publicKey, 'PC thấy được khoá định danh của điện thoại');
  assert.deepEqual(opened.sessionRecord, sealed.sessionRecord, 'hai bên dựng ra cùng bản ghi phiên');
});

test('gói tin: mã hoá/giải mã bằng bản ghi phiên từ metadata', async () => {
  const crypto = await cryptoPromise;
  const pcIdentity = crypto.generateKeyPair();
  const pcEphemeral = crypto.generateKeyPair();
  const phoneIdentity = crypto.generateKeyPair();

  const sealed = crypto.createMetadataCipher(
    encoder.encode('meta'),
    phoneIdentity.publicKey, phoneIdentity.privateKey,
    pcIdentity.publicKey, pcEphemeral.publicKey,
  );
  const opened = crypto.decryptMetadata(
    sealed.ciphertext, pcIdentity.publicKey, pcIdentity.privateKey, pcEphemeral.privateKey,
  );

  const body = encoder.encode('{"msg":"xin chào"}');
  const encrypted = crypto.encryptMessage(body, opened.sessionRecord);
  const decrypted = crypto.decryptMessage(encrypted.ciphertext, opened.sessionRecord);

  assert.deepEqual(decrypted.plaintext, body);
  assert.deepEqual(encrypted.sessionId, decrypted.sessionId);
});

test('sai khoá thì thất bại bằng lỗi của wasm, không phải bằng kết quả rỗng', async () => {
  const crypto = await cryptoPromise;
  const pcIdentity = crypto.generateKeyPair();
  const pcEphemeral = crypto.generateKeyPair();
  const phoneIdentity = crypto.generateKeyPair();
  const strangerKey = crypto.generateKeyPair();

  const sealed = crypto.createMetadataCipher(
    encoder.encode('meta'),
    phoneIdentity.publicKey, phoneIdentity.privateKey,
    pcIdentity.publicKey, pcEphemeral.publicKey,
  );

  assert.throws(
    () => crypto.decryptMetadata(
      sealed.ciphertext, pcIdentity.publicKey, pcIdentity.privateKey, strangerKey.privateKey,
    ),
    (error: unknown) => error instanceof SyncCryptoError && /aead/i.test((error as Error).message),
  );
});

test('wasm nhúng là bản gốc từ bộ cài Zalo', () => {
  // Khoá bằng hash: nếu ai đó thay file, test này nói ngay rằng ABI có thể đã
  // đổi. Cập nhật hash chỉ được làm cùng lúc với việc chạy lại toàn bộ test
  // trên wasm mới — nếu không, giá trị của khoá này bằng không.
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.equal(digest, '398a2016ede72d1e604a6ac13bc7c62f2c44a43f0c1d7b996e968427380fc739');
});

