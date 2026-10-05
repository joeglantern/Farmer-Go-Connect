/** Application error with a stable machine-readable code and an HTTP status. */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  unauthorized: (message = 'Sign in to continue') => new AppError('UNAUTHORIZED', message, 401),
  forbidden: (message = 'You do not have permission to do this') => new AppError('FORBIDDEN', message, 403),
  notFound: (entity: string) => new AppError('NOT_FOUND', `${entity} not found`, 404),
  conflict: (code: string, message: string) => new AppError(code, message, 409),
  badRequest: (code: string, message: string, details?: unknown) => new AppError(code, message, 400, details),
  unprocessable: (code: string, message: string, details?: unknown) =>
    new AppError(code, message, 422, details),
  upstream: (code: string, message: string) => new AppError(code, message, 502),
};
