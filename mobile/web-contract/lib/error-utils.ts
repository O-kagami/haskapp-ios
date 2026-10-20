type ErrorRecord = Record<string, unknown>;

function isErrorRecord(value: unknown): value is ErrorRecord {
  return typeof value === "object" && value !== null;
}

export function getErrorMessage(error: unknown, fallback = "予期しないエラーが発生しました"): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;

  if (isErrorRecord(error)) {
    for (const key of ["message", "error_description", "details", "hint"] as const) {
      const value = error[key];
      if (typeof value === "string" && value.trim()) return value;
    }
  }

  return fallback;
}

export function toError(error: unknown, context?: string): Error {
  if (error instanceof Error) return error;

  const message = getErrorMessage(error);
  return new Error(context ? `${context}: ${message}` : message, { cause: error });
}
