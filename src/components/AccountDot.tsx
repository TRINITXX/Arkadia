/** Triangle, unlike the round agent badges, so the two never read alike. */
export function AccountDot({
  color,
  size = 8,
  title,
}: {
  color: string;
  size?: number;
  title?: string;
}) {
  return (
    <span
      title={title}
      className="inline-block shrink-0"
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        clipPath: "polygon(50% 0, 100% 100%, 0 100%)",
      }}
    />
  );
}
