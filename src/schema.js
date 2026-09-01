// Builders for the small subset of JSON Schema the tool definitions use.

export function objectSchema(properties, required = []) {
  return { type: "object", properties, required, additionalProperties: false };
}

export function stringSchema(description) {
  return { type: "string", description };
}

export function numberSchema(description) {
  return { type: "number", description };
}

export function booleanSchema(description) {
  return { type: "boolean", description };
}

export function enumSchema(values, description) {
  return { type: "string", enum: values, description };
}

// Shared by every write tool so the confirmation parameter reads the same way
// wherever it appears.
export const CONFIRM_DESCRIPTION =
  "must be true to execute this write operation; set it only after the user has confirmed the change";
