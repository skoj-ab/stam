export class ShareRegisterError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ShareRegisterError";
    this.code = code;
  }
}
