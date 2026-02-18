export class ControlPlaneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ControlPlaneError';
  }
}

export class AuthenticationError extends ControlPlaneError {
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends ControlPlaneError {
  constructor(message = 'Insufficient permissions') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export class QuotaExceededError extends ControlPlaneError {
  constructor(message = 'Quota exceeded') {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

export class ApiKeyNotFoundError extends ControlPlaneError {
  constructor(id: string) {
    super(`API key "${id}" not found`);
    this.name = 'ApiKeyNotFoundError';
  }
}
