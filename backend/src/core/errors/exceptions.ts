/**
 * Consistent error model (docs/ARCHITECTURE.md: predictable errors, no
 * raw database/framework exceptions leaked to the client).
 *
 * Every domain/application error raised anywhere in the codebase must
 * be one of these -- never a bare Error, database driver error, or
 * framework exception surfaced directly to the API layer.
 */

export class AppError extends Error {
  readonly statusCode: number = 500;
  readonly errorCode: string = "internal_error";

  constructor(message?: string) {
    super(message ?? "An error occurred.");
    this.name = new.target.name;
  }
}

export class ValidationAppError extends AppError {
  readonly statusCode = 422;
  readonly errorCode = "validation_error";

  constructor(message = "The request contains invalid data.") {
    super(message);
  }
}

export class AuthError extends AppError {
  readonly statusCode = 401;
  readonly errorCode = "auth_error";

  constructor(message = "Authentication failed.") {
    super(message);
  }
}

export class ForbiddenError extends AppError {
  readonly statusCode = 403;
  readonly errorCode = "forbidden";

  constructor(message = "You are not allowed to perform this action.") {
    super(message);
  }
}

export class NotFoundAppError extends AppError {
  readonly statusCode = 404;
  readonly errorCode = "not_found";

  constructor(entity: string) {
    super(`${entity} not found.`);
  }
}

export class ConflictError extends AppError {
  readonly statusCode = 409;
  readonly errorCode = "conflict";

  constructor(message = "This action conflicts with existing data.") {
    super(message);
  }
}

export class BusinessRuleError extends AppError {
  readonly statusCode = 422;
  readonly errorCode = "business_rule_violation";

  constructor(message = "This action violates a business rule.") {
    super(message);
  }
}

export class InfrastructureError extends AppError {
  readonly statusCode = 502;
  readonly errorCode = "infrastructure_error";

  constructor(message = "An infrastructure dependency failed.") {
    super(message);
  }
}
