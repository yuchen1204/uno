import { CardColor } from "../types";

interface Props {
  onSelect: (color: CardColor) => void;
}

const COLORS: { color: CardColor; label: string }[] = [
  { color: "red", label: "红" },
  { color: "yellow", label: "黄" },
  { color: "blue", label: "蓝" },
  { color: "green", label: "绿" },
];

export default function ColorPicker({ onSelect }: Props) {
  return (
    <div className="modal-overlay">
      <div className="modal" style={{ textAlign: "center" }}>
        <h2>选择颜色</h2>
        <div className="color-picker">
          {COLORS.map(c => (
            <button
              key={c.color}
              className={`color-btn ${c.color}`}
              onClick={() => onSelect(c.color)}
              title={c.label}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
