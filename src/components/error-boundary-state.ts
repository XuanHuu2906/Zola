/**
 * Phần suy luận của `ErrorBoundary`, tách khỏi `.tsx`.
 *
 * Lý do tách: node chạy test bằng cách bóc kiểu, **không** hiểu JSX, nên một file
 * `.tsx` không import được từ `tests/`. Logic đáng test ở đây không phải JSX mà
 * là **khi nào thì reset** — chỗ dễ sai nhất và cũng là chỗ quyết định người dùng
 * có thoát được khỏi màn hình lỗi hay không.
 */

export interface BoundaryState {
  error: Error | null;
  /** `resetKey` của lần render gần nhất; đổi là reset. */
  seenResetKey: string | undefined;
}

/**
 * Reset khi `resetKey` đổi.
 *
 * Đặt trong `getDerivedStateFromProps` chứ không `componentDidUpdate`: cập nhật
 * state trong `componentDidUpdate` khiến React render thêm một lần với màn hình
 * lỗi trước khi reset có tác dụng — người dùng thấy nó nhấp nháy.
 *
 * Chỉ reset theo `resetKey`; bấm "Thử lại" gọi thẳng `setState({error:null})` và
 * giữ `seenResetKey` nguyên, nên lần render sau **không** bị reset lần nữa.
 */
export function deriveBoundaryState(
  resetKey: string | undefined, state: BoundaryState,
): BoundaryState | null {
  if (resetKey === state.seenResetKey) return null;
  return { error: null, seenResetKey: resetKey };
}
