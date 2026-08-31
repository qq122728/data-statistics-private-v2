"use client";

/** 通用弹窗容器——开通账号、设置岗位、发起转岗这些"填表单"的操作都走这个，
 *  跟 ConfirmDialog 是两回事：这个装的是自由表单，提交后再走 ConfirmDialog 二次确认。 */
export function Modal({
  open, onClose, title, note, width = 460, children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  note?: string;
  width?: number;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: "fixed", inset: 0, zIndex: 90,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        background: "rgba(19,24,36,.42)",
      }}
    >
      <div
        role="dialog" aria-modal="true"
        style={{
          width: "100%", maxWidth: width, maxHeight: "86vh", overflowY: "auto",
          background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius-lg)",
          boxShadow: "0 20px 50px rgba(19,24,36,.22)",
        }}
      >
        <div style={{ padding: "18px 20px 4px" }}>
          <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 700 }}>{title}</h3>
          {note ? <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--ink-3)" }}>{note}</p> : null}
        </div>
        <div style={{ padding: "14px 20px 20px" }}>{children}</div>
      </div>
    </div>
  );
}
