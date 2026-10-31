import type { ElicitField, ElicitValues } from "@/lib/chat/chatElicitation";

/** One field of the form, as its schema says. */
export function ChatElicitField({
  field,
  value,
  onChange,
}: {
  field: ElicitField;
  value: ElicitValues[string] | undefined;
  onChange: (value: ElicitValues[string]) => void;
}) {
  const label = (
    <span className="lbl">
      {field.label}
      {field.required && <i> *</i>}
    </span>
  );
  const hint = field.description && (
    <span className="hint">{field.description}</span>
  );
  if (field.kind === "boolean") {
    return (
      <label className="chat-elicit-field check">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
        {hint}
      </label>
    );
  }
  if (field.kind === "choice" || field.kind === "multi") {
    const picked = Array.isArray(value)
      ? value
      : typeof value === "string" && value
        ? [value]
        : [];
    return (
      <div className="chat-elicit-field">
        {label}
        {hint}
        <div className="opts">
          {field.options.map((o) => {
            const on = picked.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                className={`chat-chip${on ? " on" : ""}`}
                aria-pressed={on}
                onClick={() =>
                  field.kind === "multi"
                    ? onChange(
                        on
                          ? picked.filter((v) => v !== o.value)
                          : [...picked, o.value],
                      )
                    : onChange(on ? "" : o.value)
                }
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  return (
    <label className="chat-elicit-field">
      {label}
      {hint}
      <input
        className="chat-ask-other"
        type={
          field.kind === "number"
            ? "text"
            : field.format === "email"
              ? "email"
              : field.format === "date"
                ? "date"
                : "text"
        }
        inputMode={field.kind === "number" ? "decimal" : undefined}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
