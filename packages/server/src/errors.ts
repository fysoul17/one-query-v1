export class ServerError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = 'ServerError';
    this.statusCode = statusCode;
  }
}

export class BadRequestError extends ServerError {
  constructor(message = 'Bad request') {
    super(message, 400);
    this.name = 'BadRequestError';
  }
}

export class NotFoundError extends ServerError {
  constructor(message = 'Not found') {
    super(message, 404);
    this.name = 'NotFoundError';
  }
}

export class NotImplementedError extends ServerError {
  constructor(message = 'Not implemented') {
    super(message, 501);
    this.name = 'NotImplementedError';
  }
}

export class InternalError extends ServerError {
  constructor(message = 'Internal server error') {
    super(message, 500);
    this.name = 'InternalError';
  }
}
