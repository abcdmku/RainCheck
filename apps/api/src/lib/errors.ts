export class AppError extends Error {
  statusCode: number
  code: string
  details?: unknown

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export function toAppError(error: unknown) {
  if (error instanceof AppError) {
    return error
  }

  return new AppError(
    500,
    'internal_error',
    error instanceof Error ? error.message : 'Unknown error',
  )
}
