const SIZE = 26;
const STROKE = 3;
const R = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * R;

/** A gauge of the status bar: a ring that fills up to `percent`, its figure inside. */
export function ChatRing({ percent, hot }: { percent: number; hot: boolean }) {
  const filled = (Math.min(100, Math.max(0, percent)) / 100) * CIRCUMFERENCE;
  return (
    <span className={hot ? "chat-ring hot" : "chat-ring"}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} className="track" />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          className="fill"
          strokeDasharray={`${filled} ${CIRCUMFERENCE}`}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      </svg>
      <i>{Math.round(percent)}</i>
    </span>
  );
}
