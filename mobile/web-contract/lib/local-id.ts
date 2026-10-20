// The counter also protects runtimes without randomUUID when the clock does not advance.
let sequence = 0;
export function createLocalId(prefix: string): string {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${++sequence}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}
