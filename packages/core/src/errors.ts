export type ErrorCode =
  | 'ConfigError'
  | 'CaptchaError'
  | 'LoginError'
  | 'ScrapeError'
  | 'NotifyError'
  | 'TimeoutError';

export class AppError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    this.name = code;
  }
}

export class ConfigError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super('ConfigError', message, options);
  }
}
export class CaptchaError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super('CaptchaError', message, options);
  }
}
export class LoginError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super('LoginError', message, options);
  }
}
export class ScrapeError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super('ScrapeError', message, options);
  }
}
export class NotifyError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super('NotifyError', message, options);
  }
}
export class TimeoutError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super('TimeoutError', message, options);
  }
}
