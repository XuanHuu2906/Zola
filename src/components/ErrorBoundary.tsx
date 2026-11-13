import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RotateCw, TriangleAlert } from 'lucide-react';
import { deriveBoundaryState, type BoundaryState } from './error-boundary-state.ts';

/**
 * Lỗi render của React (plan §9.1: "hiển thị thông báo … thay vì crash").
 *
 * Không có boundary, một `throw` trong lúc render làm React gỡ **toàn bộ** cây:
 * cửa sổ trắng, không nút, không lời giải thích. Đó là kiểu hỏng tệ nhất cho một
 * app chat — người dùng mất cả phiên vì một tin có hình dạng lạ.
 *
 * Boundary CỐ Ý chỉ bọc phần nội dung, không bọc `App`: bọc cả app thì chính cái
 * khung (tiêu đề, nút đóng cửa sổ) cũng biến mất theo, và người dùng không còn
 * cách nào thoát ngoài kill tiến trình.
 *
 * `resetKey` đổi (ví dụ khi chọn hội thoại khác) là reset: lỗi của một hội thoại
 * không được khoá luôn những hội thoại còn đọc được.
 */

interface Props { children: ReactNode; resetKey?: string; onError?: (error: Error, info: ErrorInfo) => void }

export class ErrorBoundary extends Component<Props, BoundaryState> {
  state: BoundaryState = { error: null, seenResetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: BoundaryState): BoundaryState | null {
    return deriveBoundaryState(props.resetKey, state);
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    try { this.props.onError?.(error, info); } catch { /* báo cáo hỏng không được làm hỏng thêm */ }
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return <div className="crash-fallback glass-card" role="alert" aria-labelledby="crash-title">
      <span className="crash-emblem" aria-hidden="true"><TriangleAlert size={24} /></span>
      <h1 id="crash-title">Không hiển thị được nội dung này</h1>
      <p>Một lỗi khi vẽ giao diện đã dừng phần đang xem. Tin nhắn đã lưu không bị ảnh hưởng;
        chọn hội thoại khác hoặc thử lại.</p>
      {/* Thông điệp thô, đã cắt: đây là app cục bộ, người dùng chính là người chẩn đoán. */}
      <code className="crash-detail">{this.state.error.message || this.state.error.name}</code>
      <button className="primary-btn" type="button" onClick={() => this.setState({ error: null })}>
        <RotateCw size={15} />Thử lại</button>
    </div>;
  }
}
