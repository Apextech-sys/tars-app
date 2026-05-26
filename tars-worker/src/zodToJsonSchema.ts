import { z } from "zod";

// biome-ignore lint/suspicious/noExplicitAny: schema introspection is loose
export function zodToJsonSchema(schema: z.ZodTypeAny): any {
  const def = (schema as unknown as { _def: any })._def;
  if (!def) return {};
  const t = def.typeName ?? def.type;

  switch (t) {
    case "ZodObject":
    case "object": {
      const shape =
        typeof def.shape === "function" ? def.shape() : def.shape ?? {};
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(value as z.ZodTypeAny);
        const v = value as unknown as { isOptional?: () => boolean; _def: any };
        const inner = (v as any)._def;
        const isOpt =
          (typeof v.isOptional === "function" && v.isOptional()) ||
          inner?.typeName === "ZodOptional" ||
          inner?.type === "optional";
        if (!isOpt) required.push(key);
      }
      return {
        type: "object",
        properties,
        required,
        additionalProperties: false,
      };
    }
    case "ZodArray":
    case "array":
      return {
        type: "array",
        items: zodToJsonSchema(def.type ?? def.element),
      };
    case "ZodString":
    case "string":
      return { type: "string" };
    case "ZodNumber":
    case "number":
      return { type: "number" };
    case "ZodBoolean":
    case "boolean":
      return { type: "boolean" };
    case "ZodEnum":
    case "enum": {
      const raw = def.values ?? def.entries ?? [];
      // Zod v4 returns enum values as an object { Key: "Key", ... }; v3 as array. Normalize.
      const values = Array.isArray(raw)
        ? raw
        : (raw && typeof raw === "object" ? Object.values(raw) : []);
      return { type: "string", enum: values };
    }
    case "ZodOptional":
    case "optional":
      return zodToJsonSchema(def.innerType ?? def.type);
    case "ZodNullable":
    case "nullable": {
      const inner = zodToJsonSchema(def.innerType ?? def.type);
      return { anyOf: [inner, { type: "null" }] };
    }
    case "ZodLiteral":
    case "literal":
      return { const: def.value };
    case "ZodUnion":
    case "union":
      return { anyOf: (def.options ?? []).map(zodToJsonSchema) };
    default:
      return {};
  }
}
