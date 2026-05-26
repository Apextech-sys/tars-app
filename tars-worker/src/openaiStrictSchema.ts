// Post-process a JSON Schema to comply with OpenAI strict structured output:
//  - every object includes all its property keys in `required`
//  - every object sets `additionalProperties: false`
//  - optional fields become `{ anyOf: [originalType, { type: "null" }] }` and are listed in required
// biome-ignore lint/suspicious/noExplicitAny: schema walking is loose
export function makeOpenAIStrict(schema: any): any {
  if (schema === null || typeof schema !== "object") return schema;
  // Strip $schema; OpenAI rejects extra root keys in some endpoints
  const cloned: any = Array.isArray(schema) ? schema.map(makeOpenAIStrict) : { ...schema };
  if (!Array.isArray(schema)) {
    delete cloned.$schema;
    if (cloned.type === "object" && cloned.properties && typeof cloned.properties === "object") {
      const props = cloned.properties as Record<string, any>;
      const newProps: Record<string, any> = {};
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
    for (const key of ["anyOf", "oneOf", "allOf"]) {
      if (Array.isArray(cloned[key])) {
        cloned[key] = cloned[key].map(makeOpenAIStrict);
      }
    }
  }
  return cloned;
}
