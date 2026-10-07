/**
 * Account mark: the first letter of the account's name in a square of its
 * colour — unlike the round agent badges, so the two never read alike.
 */
export function AccountDot({
  color,
  label,
  size = 13,
  title,
}: {
  color: string;
  label: string;
  size?: number;
  title?: string;
}) {
  const letter = (Array.from(label.trim())[0] ?? "?").toUpperCase();
  return (
    <span
      title={title}
      aria-label={title ?? label}
      className="inline-flex shrink-0 items-center justify-center rounded-[3px] font-semibold leading-none text-zinc-950"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.7),
        backgroundColor: color,
      }}
    >
      {letter}
    </span>
  );
}
