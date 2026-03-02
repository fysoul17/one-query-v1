import { describe, expect, test } from 'bun:test';
import { BadRequestError, NotFoundError, ServerError } from '../src/errors.ts';

describe('ServerError', () => {
  test('has default status code 500', () => {
    const err = new ServerError('something went wrong');
    expect(err.statusCode).toBe(500);
    expect(err.message).toBe('something went wrong');
    expect(err.name).toBe('ServerError');
  });

  test('accepts custom status code', () => {
    const err = new ServerError('custom', 418);
    expect(err.statusCode).toBe(418);
  });

  test('extends Error', () => {
    expect(new ServerError('test')).toBeInstanceOf(Error);
  });
});

describe('BadRequestError', () => {
  test('has status 400', () => {
    const err = new BadRequestError('bad input');
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe('BadRequestError');
  });

  test('has default message', () => {
    const err = new BadRequestError();
    expect(err.message).toBe('Bad request');
  });

  test('extends ServerError', () => {
    expect(new BadRequestError()).toBeInstanceOf(ServerError);
  });
});

describe('NotFoundError', () => {
  test('has status 404', () => {
    const err = new NotFoundError('missing');
    expect(err.statusCode).toBe(404);
    expect(err.name).toBe('NotFoundError');
  });

  test('has default message', () => {
    const err = new NotFoundError();
    expect(err.message).toBe('Not found');
  });
});
