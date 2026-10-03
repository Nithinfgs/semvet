/** A problem the user can fix (bad flag, missing build output, no network). Printed without a stack trace. */
export class SemvetError extends Error {
  readonly hint: string | undefined;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = "SemvetError";
    this.hint = hint;
  }
}
