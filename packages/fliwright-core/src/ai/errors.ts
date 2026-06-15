export interface AiInvocationErrorOptions {
  cause?: unknown;
  artifactsDir?: string;
}

export class AiInvocationError extends Error {
  readonly artifactsDir?: string;

  constructor(message: string, options: AiInvocationErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.artifactsDir = options.artifactsDir;
  }
}

export class AiDisabledError extends AiInvocationError {}

export class AiTimeoutError extends AiInvocationError {}

export class AiParseError extends AiInvocationError {}

export class AiSchemaValidationError extends AiInvocationError {}

export class AiAssertionError extends AiInvocationError {
  readonly reason: string;

  constructor(reason: string, options: AiInvocationErrorOptions = {}) {
    super(`AI assertion failed: ${reason}`, options);
    this.reason = reason;
  }
}
