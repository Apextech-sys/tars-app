// biome-ignore-all lint/style/useFilenamingConvention: this module's camelCase name is imported across the worker; renaming to kebab-case would break import paths
import type { z } from "zod";

/** A loosely-typed JSON Schema fragment produced by this converter. */
type JsonSchema = Record<string, unknown>;

/**
 * Zod's internal `_def` shape is not part of its public type surface and differs
 * between v3 and v4, so we treat it as an open record and narrow each field at
 * the point of use. This is a genuine external boundary, not a shortcut.
 */
type ZodDef = Record<string, unknown>;

function getDef(schema: unknown): ZodDef | undefined {
  const def = (schema as { _def?: unknown })?._def;
  return def && typeof def === "object" ? (def as ZodDef) : undefined;
}

function isOptionalValue(value: unknown): boolean {
  const v = value as { isOptional?: () => boolean };
  if (typeof v.isOptional === "function" && v.isOptional()) {
    return true;
  }
  const inner = getDef(value);
  return inner?.typeName === "ZodOptional" || inner?.type === "optional";
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a flat switch over zod type tags (v3 + v4 aliases); each branch is trivial and splitting it would obscure the 1:1 type mapping
export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const def = getDef(schema);
  if (!def) {
    return {};
  }
  const t = def.typeName ?? def.type;

  switch (t) {
    case "ZodObject":
    case "object": {
      const rawShape = def.shape;
      const shape = (
        typeof rawShape === "function" ? rawShape() : (rawShape ?? {})
      ) as Record<string, unknown>;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(value as z.ZodTypeAny);
        if (!isOptionalValue(value)) {
          required.push(key);
        }
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
        items: zodToJsonSchema((def.type ?? def.element) as z.ZodTypeAny),
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
      let values: unknown[];
      if (Array.isArray(raw)) {
        values = raw;
      } else if (raw && typeof raw === "object") {
        values = Object.values(raw);
      } else {
        values = [];
      }
      return { type: "string", enum: values };
    }
    case "ZodOptional":
    case "optional":
      return zodToJsonSchema((def.innerType ?? def.type) as z.ZodTypeAny);
    case "ZodNullable":
    case "nullable": {
      const inner = zodToJsonSchema(
        (def.innerType ?? def.type) as z.ZodTypeAny
      );
      return { anyOf: [inner, { type: "null" }] };
    }
    case "ZodLiteral":
    case "literal":
      return { const: def.value };
    case "ZodUnion":
    case "union":
      return {
        anyOf: ((def.options ?? []) as z.ZodTypeAny[]).map(zodToJsonSchema),
      };
    default:
      return {};
  }
}
