/**
 * Bootstrap cho `node --test`: đổi `./x.js` thành `./x.ts` khi chạy thẳng mã
 * nguồn.
 *
 * `electron/` biên dịch sang CommonJS cho Electron, nên mọi import nội bộ của nó
 * ghi `./mapper.js` — đúng tên file **sau** khi build. Chạy thẳng `.ts` bằng
 * node thì đuôi đó không tồn tại.
 *
 * Mỗi tệp test tự đăng ký một hook như `tests/zalo-cache.test.ts`, nhưng hook
 * trong **thân** tệp chỉ có tác dụng cho những lần `import()` động: import tĩnh
 * đã được phân giải xong trước khi thân tệp chạy. Vì vậy chỉ cần một tệp khác
 * trong cùng tiến trình đăng ký trước là cả loạt chạy được — và chạy riêng một
 * tệp thì hỏng. Preload này bỏ hẳn sự phụ thuộc vào thứ tự đó.
 */
import { registerHooks } from 'node:module';

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
