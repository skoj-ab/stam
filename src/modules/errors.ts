export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ApplicationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplicationConflictError";
  }
}
