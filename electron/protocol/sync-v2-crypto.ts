/**
 * Binding WASM cho mật mã của **Sync V2** (`transfer_sync2`) — đường đồng bộ
 * tin nhắn cũ điện thoại → PC bằng phiên ed25519.
 *
 * Vì sao phải có file này: Sync V2 **không** phải "tải một file backup mã hoá
 * rồi giải bằng một khoá". Đó là `backup_pc2mb` (PC → điện thoại), một tính
 * năng khác hẳn. Sync V2 là phiên trao đổi khoá có bản ghi phiên (Double
 * Ratchet) do Zalo PC dựng trong `shared-worker` (`CdmT.js`, lớp `Vo`), và toàn
 * bộ phần khó nằm trong `libzproto_wasm_bg.5ea0fb2c9af4a45bc7882b71307b6f83.wasm`.
 *
 * File này **không** chép glue `Vox7.js` của Zalo (565 dòng minified, gọi
 * `__webpack_require__` giả). Nó viết lại phần binding wasm-bindgen cần thiết,
 * vì:
 *
 * 1. Glue đó có hai getter sai tên export. Lớp `W` (`Vox7.js:398-427`) đặt tên
 *    getter là `ciphertext` nhưng gọi `zprotosyncmetadatadecrypted_plaintext`;
 *    đúng phải là `zprotosyncmetadataencrypted_ciphertext`.
 * 2. Binding 200 dòng đọc được thì test được; file minified thì không.
 *
 * **Hợp đồng ABI** (đo trực tiếp trên wasm của bản cài hiện tại — xem
 * `tests/sync-v2-crypto.test.ts`):
 *
 * - 39 import, tất cả nằm trong namespace `wbg`. Không import nào ngoài `wbg`,
 *   nên wasm nạp được bên trong tiến trình main của Electron mà không cần
 *   `fetch` hay `instantiateStreaming`.
 * - 1 export `memory`, 40 export hàm.
 * - Các hàm sinh đối tượng ghi kết quả vào `retptr` 12 byte:
 *   `[handle: i32][errorRef: i32][isError: i32]`. `handle` khác 0 là con trỏ tới
 *   đối tượng trong bộ nhớ wasm, phải được giải phóng bằng hàm `__wbg_*_free`.
 * - Các hàm đọc thuộc tính (`*_publicKey`, `*_sessionId`, `*_ciphertext`…) trả
 *   **chỉ mục bảng tham chiếu** (externref), không phải `(ptr, len)`. Giá trị
 *   trong bảng là một `Uint8Array` — view trên bộ nhớ wasm, nên phải `.slice()`
 *   trước khi gọi wasm lần nữa, nếu không bộ nhớ lớn lên sẽ làm view chết.
 *
 * Ranh giới ADR-004: file này **không** import `zca-js`, không giữ cookie, không
 * IMEI, không userAgent. Nó chỉ nhận và trả mảng byte.
 */
import nodeCrypto from 'node:crypto';

/**
 * Bảng tham chiếu kiểu wasm-bindgen: chỉ mục ⇄ giá trị JS.
 *
 * Bốn ô đầu (0..3) là `undefined`, `null`, `true`, `false`; ô 4 là `undefined`
 * dành riêng. wasm-bindgen coi mọi chỉ mục dưới 132 là vùng không được tái sử
 * dụng, nên `drop` chỉ trả ô từ 132 trở lên.
 */
class RefTable {
  private readonly entries: unknown[];
  private free: number;

  constructor() {
    // Bố cục chuẩn của wasm-bindgen: 128 ô rỗng, rồi `undefined`, `null`, `true`,
    // `false`; ô trống kế tiếp là 132. Chỉ chỉ mục ≥ 132 mới được tái sử dụng.
    this.entries = new Array<unknown>(128).fill(undefined);
    this.entries.push(undefined, null, true, false);
    this.free = this.entries.length;
  }

  get(index: number): unknown {
    return this.entries[index];
  }

  put(value: unknown): number {
    if (this.free === this.entries.length) this.entries.push(this.entries.length + 1);
    const slot = this.free;
    this.free = this.entries[slot] as number;
    this.entries[slot] = value;
    return slot;
  }

  drop(index: number): unknown {
    const value = this.entries[index];
    if (index >= 132) {
      this.entries[index] = this.free;
      this.free = index;
    }
    return value;
  }
}

/** Một cặp khoá ed25519. `publicKey` 33 byte, `privateKey` 32 byte. */
export interface Ed25519KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/** Kết quả mã hoá metadata — phần điện thoại phải trả lời khi nhận yêu cầu. */
export interface SyncMetadataCipher {
  sessionId: Uint8Array;
  ciphertext: Uint8Array;
  receiverIdentity: Uint8Array;
  /** Bản ghi phiên; đầu vào cho mọi gói tin sau đó. */
  sessionRecord: Uint8Array;
}

/**
 * Kết quả giải mã metadata.
 *
 * Không kế thừa `SyncMetadataCipher`: gói đã giải không còn `ciphertext` lẫn
 * `receiverIdentity`, và bịa hai trường rỗng chỉ để tái dùng interface sẽ khiến
 * người đọc tưởng chúng có nghĩa.
 */
export interface SyncDecryptedMetadata {
  sessionId: Uint8Array;
  plaintext: Uint8Array;
  senderIdentity: Uint8Array;
  /** Bản ghi phiên; đầu vào cho mọi gói tin sau đó. */
  sessionRecord: Uint8Array;
}

/** Kết quả mã hoá một gói tin. */
export interface SyncEncryptedMessage {
  sessionId: Uint8Array;
  ciphertext: Uint8Array;
}

/** Kết quả giải mã một gói tin. */
export interface SyncDecryptedMessage {
  sessionId: Uint8Array;
  plaintext: Uint8Array;
}

/** Lỗi từ wasm (định dạng sai, sai khoá, AEAD hỏng). */
export class SyncCryptoError extends Error {
  /** Mã lỗi của thư viện: `{code, message}` do wasm đẩy qua bảng tham chiếu. */
  readonly code: unknown;

  constructor(message: string, code?: unknown) {
    super(message);
    this.name = 'SyncCryptoError';
    this.code = code;
  }
}

/**
 * `wbg` đẩy **object thuần** `{code, message}` vào bảng tham chiếu, không phải
 * `Error`. Đã đo trên wasm thật: giải bằng khoá sai cho
 * `{code: ..., message: "Decryption failed: aead::Error"}`.
 *
 * Đọc thẳng `String(value)` ở đây từng cho ra `"[object Object]"` — một thông
 * báo lỗi không nói được gì về việc sai khoá hay sai định dạng. Phải lấy
 * `message`.
 */
function wasmErrorOf(value: unknown): SyncCryptoError {
  if (value instanceof SyncCryptoError) return value;
  if (value instanceof Error) return new SyncCryptoError(value.message);
  if (value && typeof value === 'object') {
    const record = value as { message?: unknown; code?: unknown };
    const message = typeof record.message === 'string' ? record.message : JSON.stringify(value);
    return new SyncCryptoError(message, record.code);
  }
  return new SyncCryptoError(String(value));
}

/** Export của wasm mà binding dùng. Tên khớp bảng export, không đổi được. */
interface WasmExports {
  memory: WebAssembly.Memory;
  __wbindgen_export_0(refIndex: number): void;
  __wbindgen_export_1(ptr: number, size: number, align: number): void;
  __wbindgen_export_2(size: number, align: number): number;
  __wbindgen_add_to_stack_pointer(delta: number): number;
  zprotoEd25519GenerateKeyPair(retptr: number): void;
  zprotoEd25519DerivePublicKey(retptr: number, privPtr: number, privLen: number): void;
  zprotoed25519keypair_publicKey(handle: number): number;
  zprotoed25519keypair_privateKey(handle: number): number;
  __wbg_zprotoed25519keypair_free(handle: number, dealloc: number): void;
  zprotoSync2CreateMetadataCipher(
    retptr: number,
    ptPtr: number, ptLen: number,
    aPtr: number, aLen: number,
    bPtr: number, bLen: number,
    cPtr: number, cLen: number,
    dPtr: number, dLen: number,
  ): void;
  zprotoSync2DecryptMetadata(
    retptr: number,
    ctPtr: number, ctLen: number,
    aPtr: number, aLen: number,
    bPtr: number, bLen: number,
    cPtr: number, cLen: number,
    dPtr: number, dLen: number,
  ): void;
  zprotoSync2EncryptMessage(retptr: number, ptPtr: number, ptLen: number, srPtr: number, srLen: number): void;
  zprotoSync2DecryptMessage(retptr: number, ctPtr: number, ctLen: number, srPtr: number, srLen: number): void;
  zprotosyncmetadataencrypted_sessionId(handle: number): number;
  zprotosyncmetadataencrypted_ciphertext(handle: number): number;
  zprotosyncmetadataencrypted_receiverIdentity(handle: number): number;
  zprotosyncmetadataencrypted_sessionRecord(handle: number): number;
  __wbg_zprotosyncmetadataencrypted_free(handle: number, dealloc: number): void;
  zprotosyncmetadatadecrypted_sessionId(handle: number): number;
  zprotosyncmetadatadecrypted_plaintext(handle: number): number;
  zprotosyncmetadatadecrypted_senderIdentity(handle: number): number;
  zprotosyncmetadatadecrypted_sessionRecord(handle: number): number;
  __wbg_zprotosyncmetadatadecrypted_free(handle: number, dealloc: number): void;
  zprotosyncmessageencrypted_sessionId(handle: number): number;
  zprotosyncmessageencrypted_ciphertext(handle: number): number;
  __wbg_zprotosyncmessageencrypted_free(handle: number, dealloc: number): void;
  zprotosyncmessagedecrypted_sessionId(handle: number): number;
  zprotosyncmessagedecrypted_plaintext(handle: number): number;
  __wbg_zprotosyncmessagedecrypted_free(handle: number, dealloc: number): void;
}

/** Số byte của vùng `retptr` mà wasm-bindgen dùng cho mọi lời gọi trả struct. */
const RET_SLOTS = 16;

export class SyncV2Crypto {
  private exports: WasmExports;
  private readonly refs = new RefTable();
  private heapView: Uint8Array | null = null;
  private dataView: DataView | null = null;

  private constructor(exports: WasmExports) {
    this.exports = exports;
  }

  /**
   * Nạp wasm từ byte.
   *
   * Không nhận đường dẫn: module này không biết gì về `app.getAppPath()`, asar
   * hay `process.resourcesPath` — nơi gọi quyết định nhúng wasm ở đâu. Trong app
   * thật, wasm nằm ở `assets/zproto/` (xem `electron/protocol/sync-v2-wasm.ts`).
   */
  static async load(bytes: Uint8Array): Promise<SyncV2Crypto> {
    const module = await WebAssembly.compile(bytes as unknown as BufferSource);
    // `wbg` được dựng trước khi instantiate, nhưng vài import cần `exports`
    // (`__wbindgen_memory`, dealloc). Nên chúng đọc qua `binding.exports`, được
    // gắn ngay sau `instantiate` và trước mọi lời gọi từ wasm vào JS.
    const binding = new SyncV2Crypto({} as WasmExports);
    const imports = binding.createImports(() => binding.exports);
    const instance = await WebAssembly.instantiate(module, { wbg: imports });
    binding.attach(instance.exports as unknown as WasmExports);
    return binding;
  }

  private attach(exports: WasmExports): void {
    this.exports = exports;
    this.heapView = null;
    this.dataView = null;
  }

  // --------------------------------------------------------------- bộ nhớ

  /** View trên toàn bộ bộ nhớ wasm; dựng lại khi bộ nhớ lớn lên. */
  private get heap(): Uint8Array {
    const buffer = this.exports.memory.buffer;
    if (!this.heapView || this.heapView.buffer !== buffer) {
      this.heapView = new Uint8Array(buffer);
      this.dataView = new DataView(buffer);
    }
    return this.heapView;
  }

  private get data(): DataView {
    void this.heap;
    return this.dataView as DataView;
  }

  /** Chép byte vào bộ nhớ wasm, trả con trỏ. */
  private alloc(bytes: Uint8Array): number {
    const ptr = this.exports.__wbindgen_export_2(bytes.length, 1) >>> 0;
    this.heap.set(bytes, ptr);
    return ptr;
  }

  /** Đọc một `Vec<u8>` wasm trả qua `retptr` rồi trả vùng nhớ cho wasm. */
  private takeVec(ptr: number, len: number): Uint8Array {
    const copy = this.heap.slice(ptr, ptr + len);
    this.exports.__wbindgen_export_1(ptr, len, 1);
    return copy;
  }

  /**
   * Đọc một giá trị `Uint8Array` wasm để trong bảng tham chiếu, rồi trả ô.
   *
   * Phải `.slice()`: giá trị là view trên bộ nhớ wasm, và lời gọi wasm kế tiếp
   * có thể làm bộ nhớ lớn lên, khiến view trỏ vào bộ đệm đã bị tách ra.
   */
  private takeRefBytes(refIndex: number): Uint8Array {
    const value = this.refs.drop(refIndex);
    if (value instanceof Uint8Array) return value.slice();
    if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
    return new Uint8Array(0);
  }

  /** Đọc `[ptr, errorRef, isError]` từ ô trả về; ném lỗi wasm nếu có. */
  private takeHandle(retptr: number): number {
    const handle = this.data.getInt32(retptr + 0, true);
    const errorRef = this.data.getInt32(retptr + 4, true);
    if (this.data.getInt32(retptr + 8, true)) throw wasmErrorOf(this.refs.drop(errorRef));
    return handle;
  }

  /** Bao một lời gọi `retptr` trong vùng stack tạm của wasm. */
  private withRetptr<T>(fn: (retptr: number) => T): T {
    const retptr = this.exports.__wbindgen_add_to_stack_pointer(-RET_SLOTS);
    try {
      return fn(retptr);
    } finally {
      this.exports.__wbindgen_add_to_stack_pointer(RET_SLOTS);
    }
  }

  // ------------------------------------------------------- wasm-bindgen wbg

  /**
   * Dựng namespace import `wbg`.
   *
   * Mỗi hàm ở đây tương ứng đúng một import của wasm. Tên có dạng `__wbg_*` /
   * `__wbindgen_*` do wasm-bindgen sinh ra và không được đổi: wasm tra chúng
   * theo tên khi instantiate. Ngữ nghĩa lấy từ chính glue `Vox7.js:428-520`;
   * test `sync-v2-crypto.test.ts` khoá lại bằng một vòng mã hoá–giải mã thật.
   */
  private createImports(exportsOf: () => WasmExports): Record<string, (...args: number[]) => unknown> {
    const refs = this.refs;
    const get = (index: number): unknown => refs.get(index);
    const put = (value: unknown): number => refs.put(value);
    /** Chuyển lỗi JS vào wasm đúng cách wasm-bindgen làm: lưu vào bảng rồi ném. */
    const guarded = (fn: () => unknown): number => {
      try {
        return put(fn());
      } catch (error) {
        exportsOf().__wbindgen_export_0(put(error));
        return 0;
      }
    };
    const str = (ptr: number, len: number): string =>
      new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(exportsOf().memory.buffer).subarray(ptr, ptr + len));

    return {
      __wbindgen_object_drop_ref: (index: number): void => { refs.drop(index); },
      __wbindgen_string_new: (ptr: number, len: number): number => put(str(ptr, len)),
      __wbindgen_number_new: (value: number): number => put(value),
      __wbindgen_object_clone_ref: (index: number): number => put(get(index)),
      __wbindgen_is_object: (index: number): boolean => typeof get(index) === 'object' && get(index) !== null,
      __wbindgen_is_string: (index: number): boolean => typeof get(index) === 'string',
      __wbindgen_is_function: (index: number): boolean => typeof get(index) === 'function',
      __wbindgen_is_undefined: (index: number): boolean => get(index) === undefined,
      __wbindgen_memory: (): number => put(exportsOf().memory),
      __wbindgen_throw: (ptr: number, len: number): void => { throw new SyncCryptoError(str(ptr, len)); },

      __wbg_new_78feb108b6472713: (): number => put([]),
      __wbg_push_737cfc8c1432c2c6: (array: number, item: number): number =>
        (get(array) as unknown[]).push(get(item)),
      __wbg_apply_36be6a55257c99bf: (fn: number, thisArg: number, args: number): number => guarded(() =>
        Reflect.apply(get(fn) as (...a: unknown[]) => unknown, get(thisArg), get(args) as unknown[])),
      __wbg_call_672a4d21634d4a24: (fn: number, thisArg: number): number => guarded(() =>
        (get(fn) as (this: unknown) => unknown).call(get(thisArg))),
      __wbg_call_7cccdd69e0791ae2: (fn: number, thisArg: number, arg: number): number => guarded(() =>
        (get(fn) as (this: unknown, a: unknown) => unknown).call(get(thisArg), get(arg))),
      __wbg_crypto_ed58b8e10a292839: (index: number): number => put((get(index) as { crypto: unknown }).crypto),
      __wbg_msCrypto_0a36e2ec3a343d26: (index: number): number => put((get(index) as { msCrypto: unknown }).msCrypto),
      __wbg_getRandomValues_bcb4912f16000dc4: (crypto: number, target: number): number => guarded(() => {
        (get(crypto) as { getRandomValues(a: Uint8Array): void }).getRandomValues(get(target) as Uint8Array);
        return undefined;
      }),
      /** `randomFillSync(buf, offset, len)` — node-target của wasm-bindgen. */
      __wbg_randomFillSync_ab2cfe79ebbf2740: (target: number, offset: number, length: number): number => guarded(() => {
        const view = get(target) as Uint8Array;
        nodeCrypto.randomFillSync(view, offset >>> 0, length >>> 0);
        return undefined;
      }),
      __wbg_buffer_609cc3eee51ed158: (index: number): number => put((get(index) as ArrayBufferView).buffer),
      __wbg_new_a12002a7f91c75be: (buffer: number): number => put(new Uint8Array(get(buffer) as ArrayBuffer)),
      __wbg_newwithbyteoffsetandlength_d97e637ebe145a9a: (buffer: number, offset: number, length: number): number =>
        put(new Uint8Array(get(buffer) as ArrayBuffer, offset >>> 0, length >>> 0)),
      __wbg_newwithlength_a381634e90c276d4: (length: number): number => put(new Uint8Array(length >>> 0)),
      __wbg_subarray_aa9065fa9dc5df96: (target: number, start: number, end: number): number =>
        put((get(target) as Uint8Array).subarray(start >>> 0, end >>> 0)),
      __wbg_set_65595bdd868b3009: (target: number, source: number, offset: number): void => {
        (get(target) as Uint8Array).set(get(source) as Uint8Array, offset >>> 0);
      },
      __wbg_new_8a6f238a6ece86ea: (): number => put(new Error()),
      __wbg_new_405e22f390576ce2: (): number => put({}),
      __wbg_set_3f1d0b984ed272ed: (target: number, key: number, value: number): void => {
        (get(target) as Record<string, unknown>)[get(key) as string] = get(value);
      },
      /** `Error.stack` vào vùng trả về `[ptr, len]` — wasm đọc rồi dealloc. */
      __wbg_stack_0ed75d68575b0f3c: (retptr: number): void => {
        const stack = String((get(retptr) as Error).stack ?? '');
        const bytes = new TextEncoder().encode(stack);
        const ptr = this.alloc(bytes);
        this.data.setInt32(retptr + 0, ptr, true);
        this.data.setInt32(retptr + 4, bytes.length, true);
      },
      /** wasm-bindgen chỉ cần nhận lại vùng nhớ của chuỗi lỗi. */
      __wbg_error_7534b8e9a36f1ab4: (ptr: number, len: number): void => {
        exportsOf().__wbindgen_export_1(ptr, len, 1);
      },
      __wbg_newnoargs_105ed471475aaf50: (ptr: number, len: number): number => put(new Function(str(ptr, len))),
      __wbg_process_5c1d670bc53614b8: (index: number): number => put((get(index) as { process: unknown }).process),
      __wbg_versions_c71aa1626a93e0a1: (index: number): number => put((get(index) as { versions: unknown }).versions),
      __wbg_node_02999533c4ea02e3: (index: number): number => put((get(index) as { node: unknown }).node),
      /** Bốn accessor `globalThis`/`self`/`window`: wasm chỉ dùng để lấy `crypto`. */
      __wbg_static_accessor_GLOBAL_88a902d13a557d07: (): number => put(typeof globalThis === 'undefined' ? null : globalThis),
      __wbg_static_accessor_GLOBAL_THIS_56578be7e9f832b0: (): number => put(typeof globalThis === 'undefined' ? null : globalThis),
      __wbg_static_accessor_SELF_37c5d418e4bf5819: (): number => put(typeof globalThis === 'undefined' ? null : globalThis),
      __wbg_static_accessor_WINDOW_5de37043a91a9c40: (): number => put(typeof window === 'undefined' ? null : window),
      /** `require("crypto")` của node-target; nơi khác không được gọi tới. */
      __wbg_require_79b1e9274cde3c87: (...args: number[]): number => guarded(() => {
        void args;
        return (name: string): unknown => {
          if (name === 'crypto') return nodeCrypto;
          throw new Error(`wasm yêu cầu module không mong đợi: ${name}`);
        };
      }),
    };
  }

  // ---------------------------------------------------------- API công khai

  /** Sinh một cặp khoá ed25519 mới. */
  generateKeyPair(): Ed25519KeyPair {
    const handle = this.withRetptr(retptr => {
      this.exports.zprotoEd25519GenerateKeyPair(retptr);
      return this.takeHandle(retptr);
    });
    try {
      return {
        publicKey: this.takeRefBytes(this.exports.zprotoed25519keypair_publicKey(handle)),
        privateKey: this.takeRefBytes(this.exports.zprotoed25519keypair_privateKey(handle)),
      };
    } finally {
      this.exports.__wbg_zprotoed25519keypair_free(handle, 0);
    }
  }

  /**
   * Suy khoá công khai từ khoá riêng 32 byte.
   *
   * Cần vì khoá định danh (`ik`) phải **sống qua các lần khởi động app**: lưu cả
   * hai nửa thì thừa, và suy lại từ nửa riêng luôn khớp (đã đo).
   *
   * Hàm này trả `Option<Vec<u8>>` chứ không phải handle: `retptr` là
   * `[ptr, len, isErr, errorRef]`. Ô 4 là cờ lỗi, ô 12 là chỉ mục lỗi — đọc ô 8
   * (như bản nháp đầu) là đọc nhầm sang `errorRef`.
   */
  derivePublicKey(privateKey: Uint8Array): Uint8Array {
    return this.withRetptr(retptr => {
      const privPtr = this.alloc(privateKey);
      this.exports.zprotoEd25519DerivePublicKey(retptr, privPtr, privateKey.length);
      const ptr = this.data.getInt32(retptr + 0, true);
      const len = this.data.getInt32(retptr + 4, true);
      if (this.data.getInt32(retptr + 8, true)) {
        throw wasmErrorOf(this.refs.drop(this.data.getInt32(retptr + 12, true)));
      }
      return this.takeVec(ptr, len);
    });
  }

  /**
   * Dựng gói metadata của **phía gửi** (điện thoại) cho phía nhận (PC).
   *
   * Bốn tham số khoá theo đúng thứ tự wasm nhận, đã dò bằng vòng thử trên wasm
   * thật: `(plaintext, senderIdentityPub, senderIdentityPriv, receiverIdentityPub,
   * receiverEphemeralPub)`. Với chiều PC nhận, phía gửi là điện thoại.
   */
  createMetadataCipher(
    plaintext: Uint8Array,
    senderIdentityPublicKey: Uint8Array,
    senderIdentityPrivateKey: Uint8Array,
    receiverIdentityPublicKey: Uint8Array,
    receiverEphemeralPublicKey: Uint8Array,
  ): SyncMetadataCipher {
    const handle = this.withRetptr(retptr => {
      const pt = this.alloc(plaintext);
      const a = this.alloc(senderIdentityPublicKey);
      const b = this.alloc(senderIdentityPrivateKey);
      const c = this.alloc(receiverIdentityPublicKey);
      const d = this.alloc(receiverEphemeralPublicKey);
      this.exports.zprotoSync2CreateMetadataCipher(
        retptr,
        pt, plaintext.length,
        a, senderIdentityPublicKey.length,
        b, senderIdentityPrivateKey.length,
        c, receiverIdentityPublicKey.length,
        d, receiverEphemeralPublicKey.length,
      );
      return this.takeHandle(retptr);
    });
    try {
      return {
        sessionId: this.takeRefBytes(this.exports.zprotosyncmetadataencrypted_sessionId(handle)),
        ciphertext: this.takeRefBytes(this.exports.zprotosyncmetadataencrypted_ciphertext(handle)),
        receiverIdentity: this.takeRefBytes(this.exports.zprotosyncmetadataencrypted_receiverIdentity(handle)),
        sessionRecord: this.takeRefBytes(this.exports.zprotosyncmetadataencrypted_sessionRecord(handle)),
      };
    } finally {
      this.exports.__wbg_zprotosyncmetadataencrypted_free(handle, 0);
    }
  }

  /**
   * Giải gói metadata của **phía nhận** (PC).
   *
   * `(ciphertext, myIkPub, myIkPriv, myEkPriv)` — thứ tự đã dò trên wasm thật.
   * Kết quả mang `sessionRecord`, thứ mà mọi gói tin sau đó cần.
   */
  decryptMetadata(
    ciphertext: Uint8Array,
    identityPublicKey: Uint8Array,
    identityPrivateKey: Uint8Array,
    ephemeralPrivateKey: Uint8Array,
  ): SyncDecryptedMetadata {
    const handle = this.withRetptr(retptr => {
      const ct = this.alloc(ciphertext);
      const a = this.alloc(identityPublicKey);
      const b = this.alloc(identityPrivateKey);
      const c = this.alloc(ephemeralPrivateKey);
      this.exports.zprotoSync2DecryptMetadata(
        retptr,
        ct, ciphertext.length,
        a, identityPublicKey.length,
        b, identityPrivateKey.length,
        c, ephemeralPrivateKey.length,
        0, 0,
      );
      return this.takeHandle(retptr);
    });
    try {
      return {
        sessionId: this.takeRefBytes(this.exports.zprotosyncmetadatadecrypted_sessionId(handle)),
        plaintext: this.takeRefBytes(this.exports.zprotosyncmetadatadecrypted_plaintext(handle)),
        senderIdentity: this.takeRefBytes(this.exports.zprotosyncmetadatadecrypted_senderIdentity(handle)),
        sessionRecord: this.takeRefBytes(this.exports.zprotosyncmetadatadecrypted_sessionRecord(handle)),
      };
    } finally {
      this.exports.__wbg_zprotosyncmetadatadecrypted_free(handle, 0);
    }
  }

  /** Mã hoá một gói tin bằng bản ghi phiên hiện tại. */
  encryptMessage(plaintext: Uint8Array, sessionRecord: Uint8Array): SyncEncryptedMessage {
    const handle = this.withRetptr(retptr => {
      const pt = this.alloc(plaintext);
      const sr = this.alloc(sessionRecord);
      this.exports.zprotoSync2EncryptMessage(retptr, pt, plaintext.length, sr, sessionRecord.length);
      return this.takeHandle(retptr);
    });
    try {
      return {
        sessionId: this.takeRefBytes(this.exports.zprotosyncmessageencrypted_sessionId(handle)),
        ciphertext: this.takeRefBytes(this.exports.zprotosyncmessageencrypted_ciphertext(handle)),
      };
    } finally {
      this.exports.__wbg_zprotosyncmessageencrypted_free(handle, 0);
    }
  }

  /** Giải một gói tin bằng bản ghi phiên lấy từ metadata. */
  decryptMessage(ciphertext: Uint8Array, sessionRecord: Uint8Array): SyncDecryptedMessage {
    const handle = this.withRetptr(retptr => {
      const ct = this.alloc(ciphertext);
      const sr = this.alloc(sessionRecord);
      this.exports.zprotoSync2DecryptMessage(retptr, ct, ciphertext.length, sr, sessionRecord.length);
      return this.takeHandle(retptr);
    });
    try {
      return {
        sessionId: this.takeRefBytes(this.exports.zprotosyncmessagedecrypted_sessionId(handle)),
        plaintext: this.takeRefBytes(this.exports.zprotosyncmessagedecrypted_plaintext(handle)),
      };
    } finally {
      this.exports.__wbg_zprotosyncmessagedecrypted_free(handle, 0);
    }
  }
}
