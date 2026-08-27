const ALLOWED = new Set(["GET_STATE", "SAVE_PIN", "UPDATE_PIN", "REMOVE_PIN", "CLEAR_ALL", "START_PICKER"]);

export function validateMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) throw new Error("invalid_message");
  if (!ALLOWED.has(message.type)) throw new Error("unknown_message");
  if (message.type === "SAVE_PIN") {
    const input = message.input;
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid_payload");
    if (String(input.quote ?? "").length > 4000 || String(input.note ?? "").length > 1000) throw new Error("payload_too_large");
    const url = new URL(String(input.url ?? ""));
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error("unsupported_url");
  }
  if (["UPDATE_PIN", "REMOVE_PIN"].includes(message.type) && typeof message.id !== "string") throw new Error("id_required");
  return message;
}

export function containsSensitiveText(value = "") {
  const text = String(value);
  return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu.test(text)
    || /(?:\+?\d[\s()-]*){10,}/u.test(text)
    || /(?:api[_-]?key|token|secret|password)\s*[:=]/iu.test(text);
}
