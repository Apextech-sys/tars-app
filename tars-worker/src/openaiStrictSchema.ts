// biome-ignore-all lint/style/useFilenamingConvention: this module's camelCase name is imported across the worker; renaming to kebab-case would break import paths
// Post-process a JSON Schema to comply with OpenAI strict structured output:
//  - every object includes all its property keys in `required`
//  - every object sets `additionalProperties: false`
//  - optional fields become `{ anyOf: [originalType, { type: "null" }] }` and are listed in required

/**
 * A mutable JSON Schema object. We only read/write the handful of keywords
 * relevant to OpenAI strict mode; everything else is preserved verbatim via the
 * index signature. The public entry point takes `unknown` because callers pass
 * zod's `toJSONSchema()` payload (a genuine external boundary) as well as
 * hand-built schemas.
 */
interface JsonSchemaNode {
  $schema?: unknown;
  type?: unknown;
  properties?: Record<string, unknown>;
  items?: unknown;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

const COMPOSITE_KEYS = ["anyOf", "oneOf", "allOf"] as const;

export function makeOpenAIStrict(schema: unknown): unknown {
  if (schema === null || typeof schema !== "object") {
    return schema;
  }
  if (Array.isArray(schema)) {
    return schema.map(makeOpenAIStrict);
  }
  // Strip $schema; OpenAI rejects extra root keys in some endpoints.
  const { $schema: _stripped, ...cloned } = schema as JsonSchemaNode;
  if (
    cloned.type === "object" &&
    cloned.properties &&
    typeof cloned.properties === "object"
  ) {
    const props = cloned.properties;
    const newProps: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) {
      newProps[k] = makeOpenAIStrict(v);
    }
    cloned.properties = newProps;
    cloned.required = Object.keys(newProps);
    cloned.additionalProperties = false;
  }
  if (cloned.type === "array" && cloned.items) {
    cloned.items = makeOpenAIStrict(cloned.items);
  }
  for (const key of COMPOSITE_KEYS) {
    const branch = cloned[key];
    if (Array.isArray(branch)) {
      cloned[key] = branch.map(makeOpenAIStrict);
    }
  }
  return cloned;
}
