export class VerificationRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerificationRejectedError";
  }
}
