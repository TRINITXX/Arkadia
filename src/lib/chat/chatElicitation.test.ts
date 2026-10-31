import { describe, expect, it } from "vitest";
import {
  elicitContent,
  elicitFields,
  elicitUrl,
  initialValues,
} from "@/lib/chat/chatElicitation";

/** The test MCP server's form, as Claude Code 2.1.314 passed it (31/10/2026). */
const SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", title: "Nom", description: "Ton prénom" },
    age: { type: "integer", title: "Âge", minimum: 0, maximum: 150 },
    plan: {
      type: "string",
      title: "Formule",
      enum: ["free", "pro"],
      enumNames: ["Gratuite", "Pro"],
    },
    newsletter: {
      type: "boolean",
      title: "Recevoir la lettre",
      default: false,
    },
  },
  required: ["name"],
};

describe("elicitation form", () => {
  const fields = elicitFields(SCHEMA);

  it("turns the schema into fields", () => {
    expect(fields.map((f) => [f.key, f.kind, f.required])).toEqual([
      ["name", "text", true],
      ["age", "number", false],
      ["plan", "choice", false],
      ["newsletter", "boolean", false],
    ]);
    expect(fields[2]).toMatchObject({
      options: [
        { value: "free", label: "Gratuite" },
        { value: "pro", label: "Pro" },
      ],
    });
  });

  it("says what to fix: a required field, a number that isn't one", () => {
    const start = initialValues(SCHEMA, fields);
    expect(elicitContent(fields, start)).toEqual({
      error: "« Nom » est requis",
    });
    expect(
      elicitContent(fields, { ...start, name: "Alexis", age: "trente" }),
    ).toEqual({ error: "« Âge » doit être un nombre" });
    expect(
      elicitContent(fields, { ...start, name: "Alexis", age: "151" }),
    ).toEqual({ error: "« Âge » : 150 au plus" });
  });

  it("answers with typed values, empty optional fields left out", () => {
    const values = {
      ...initialValues(SCHEMA, fields),
      name: " Alexis ",
      age: "30",
      newsletter: true,
    };
    expect(elicitContent(fields, values)).toEqual({
      content: { name: "Alexis", age: 30, newsletter: true },
    });
  });

  it("opens only a web page", () => {
    expect(elicitUrl("https://example.com/auth?x=1")?.host).toBe("example.com");
    expect(elicitUrl("javascript:alert(1)")).toBeNull();
    expect(elicitUrl("file:///C:/Windows/win.ini")).toBeNull();
  });
});
