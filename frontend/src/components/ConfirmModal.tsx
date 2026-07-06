interface ConfirmModalProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({ message, onConfirm, onCancel }: ConfirmModalProps) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>确认</h2>
        <p style={{ fontSize: 16, marginBottom: 20, textAlign: "center" }}>{message}</p>
        <div style={{ display: "flex", gap: 12 }}>
          <button style={{ flex: 1, background: "#ff4444" }} onClick={onConfirm}>
            确定
          </button>
          <button style={{ flex: 1 }} className="secondary" onClick={onCancel}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}