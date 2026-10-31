import type { ElicitationAnswer, JsonObject } from "@/lib/chat/chatProtocol";

/**
 * An MCP server's form (`requestedSchema`, the MCP elicitation subset of JSON
 * Schema: a flat object of strings, numbers, booleans, single and multiple
 * choices) as fields, and the values typed back into what it asked for.
 */

export interface ElicitOption {
  value: string;
  label: string;
}

interface FieldBase {
  key: string;
  label: string;
  description?: string;
  required: boolean;
}

export type ElicitField =
  | (FieldBase & {
      kind: "text";
      /** `email`, `uri`, `date`, `date-time`. */
      format?: string;
      minLength?: number;
      maxLength?: number;
    })
  | (FieldBase & {
      kind: "number";
      integer: boolean;
      min?: number;
      max?: number;
    })
  | (FieldBase & { kind: "boolean" })
  | (FieldBase & { kind: "choice"; options: ElicitOption[] })
  | (FieldBase & {
      kind: "multi";
      options: ElicitOption[];
      min?: number;
      max?: number;
    });

/** What the form holds: text as typed, ticks, picks. */
export type ElicitValues = Record<string, string | boolean | string[]>;

const obj = (v: unknown): JsonObject =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as JsonObject) : {};
const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === "number" ? v : undefined;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** `enum` (+ `enumNames`) or `oneOf`/`anyOf` of `{ const, title }`. */
function optionsOf(schema: JsonObject): ElicitOption[] | null {
  const values = arr(schema.enum).filter(
    (v): v is string => typeof v === "string",
  );
  if (values.length > 0) {
    const names = arr(schema.enumNames);
    return values.map((value, i) => ({
      value,
      label: str(names[i]) ?? value,
    }));
  }
  const consts = arr(schema.oneOf ?? schema.anyOf).map(obj);
  const options = consts.flatMap((c) => {
    const value = str(c.const);
    return value === undefined ? [] : [{ value, label: str(c.title) ?? value }];
  });
  return options.length > 0 ? options : null;
}

export function elicitFields(schema: JsonObject | undefined): ElicitField[] {
  const properties = obj(schema?.properties);
  const required = new Set(
    arr(schema?.required).filter((k): k is string => typeof k === "string"),
  );
  return Object.entries(properties).map(([key, raw]) => {
    const p = obj(raw);
    const base: FieldBase = {
      key,
      label: str(p.title) ?? key,
      description: str(p.description),
      required: required.has(key),
    };
    if (p.type === "array") {
      return {
        ...base,
        kind: "multi",
        options: optionsOf(obj(p.items)) ?? [],
        min: num(p.minItems),
        max: num(p.maxItems),
      };
    }
    const options = optionsOf(p);
    if (options) return { ...base, kind: "choice", options };
    if (p.type === "boolean") return { ...base, kind: "boolean" };
    if (p.type === "number" || p.type === "integer") {
      return {
        ...base,
        kind: "number",
        integer: p.type === "integer",
        min: num(p.minimum),
        max: num(p.maximum),
      };
    }
    return {
      ...base,
      kind: "text",
      format: str(p.format),
      minLength: num(p.minLength),
      maxLength: num(p.maxLength),
    };
  });
}

/** The form at its start: the schema's defaults, else empty. */
export function initialValues(
  schema: JsonObject | undefined,
  fields: ElicitField[],
): ElicitValues {
  const properties = obj(schema?.properties);
  const values: ElicitValues = {};
  for (const f of fields) {
    const d = obj(properties[f.key]).default;
    if (f.kind === "boolean") values[f.key] = d === true;
    else if (f.kind === "multi")
      values[f.key] = arr(d).filter((v): v is string => typeof v === "string");
    else if (typeof d === "string" || typeof d === "number")
      values[f.key] = String(d);
    else values[f.key] = "";
  }
  return values;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The answer's `content`, or what to fix first: a required field left
 * empty, a number that isn't one, out of bounds, a bad email. Empty optional
 * fields are left out.
 */
export function elicitContent(
  fields: ElicitField[],
  values: ElicitValues,
): { content: NonNullable<ElicitationAnswer["content"]> } | { error: string } {
  const content: NonNullable<ElicitationAnswer["content"]> = {};
  for (const f of fields) {
    const v = values[f.key];
    const name = `« ${f.label} »`;
    if (f.kind === "boolean") {
      content[f.key] = v === true;
      continue;
    }
    if (f.kind === "multi") {
      const picked = Array.isArray(v) ? v : [];
      if (picked.length === 0 && !f.required) continue;
      if (f.required && picked.length === 0)
        return { error: `${name} : choisis au moins une option` };
      if (f.min !== undefined && picked.length < f.min)
        return { error: `${name} : au moins ${f.min} choix` };
      if (f.max !== undefined && picked.length > f.max)
        return { error: `${name} : au plus ${f.max} choix` };
      content[f.key] = picked;
      continue;
    }
    const text = typeof v === "string" ? v.trim() : "";
    if (!text) {
      if (f.required) return { error: `${name} est requis` };
      continue;
    }
    if (f.kind === "number") {
      const n = Number(text.replace(",", "."));
      if (!Number.isFinite(n)) return { error: `${name} doit être un nombre` };
      if (f.integer && !Number.isInteger(n))
        return { error: `${name} doit être un nombre entier` };
      if (f.min !== undefined && n < f.min)
        return { error: `${name} : ${f.min} au moins` };
      if (f.max !== undefined && n > f.max)
        return { error: `${name} : ${f.max} au plus` };
      content[f.key] = n;
      continue;
    }
    if (f.kind === "choice") {
      if (!f.options.some((o) => o.value === text))
        return { error: `${name} : choisis une option` };
      content[f.key] = text;
      continue;
    }
    if (f.format === "email" && !EMAIL.test(text))
      return { error: `${name} : adresse e-mail invalide` };
    if (f.minLength !== undefined && text.length < f.minLength)
      return { error: `${name} : ${f.minLength} caractères au moins` };
    if (f.maxLength !== undefined && text.length > f.maxLength)
      return { error: `${name} : ${f.maxLength} caractères au plus` };
    content[f.key] = text;
  }
  return { content };
}

/**
 * The page an MCP server asks to open (sign-in): only a web address, shown
 * by its host. Null for anything else (`file:`, `javascript:`…).
 */
export function elicitUrl(url: string | undefined): URL | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed
      : null;
  } catch {
    return null;
  }
}
