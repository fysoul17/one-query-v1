import { describe, expect, test } from 'bun:test';
import { BadRequestError, InternalError, NotFoundError, ServerError } from '../src/errors.ts';

describe('ServerError', () => {
  test('has correct name and status code', () => {
    const error = new ServerError('test message', 503);
    expect(error.message).toBe('test message');
    expect(error.statusCode).toBe(503);
    expect(error.name).toBe('ServerError');
    expect(error).toBeInstanceOf(Error);
  });

  test('defaults to status 500', () => {
    const error = new ServerError('fail');
    expect(error.statusCode).toBe(500);
  });
});

describe('BadRequestError', () => {
  test('has status 400', () => {
    const error = new BadRequestError('missing field');
    expect(error.statusCode).toBe(400);
    expect(error.name).toBe('BadRequestError');
    expect(error.message).toBe('missing field');
    expect(error).toBeInstanceOf(ServerError);
  });

  test('defaults message', () => {
    const error = new BadRequestError();
    expect(error.message).toBe('Bad request');
  });
});

describe('NotFoundError', () => {
  test('has status 404', () => {
    const error = new NotFoundError('item not found');
    expect(error.statusCode).toBe(404);
    expect(error.name).toBe('NotFoundError');
    expect(error).toBeInstanceOf(ServerError);
  });

  test('defaults message', () => {
    const error = new NotFoundError();
    expect(error.message).toBe('Not found');
  });
});

describe('InternalError', () => {
  test('has status 500', () => {
    const error = new InternalError('db failure');
    expect(error.statusCode).toBe(500);
    expect(error.name).toBe('InternalError');
    expect(error).toBeInstanceOf(ServerError);
  });

  test('defaults message', () => {
    const error = new InternalError();
    expect(error.message).toBe('Internal server error');
  });
});
