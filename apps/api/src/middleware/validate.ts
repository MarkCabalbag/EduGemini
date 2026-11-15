import type { RequestHandler, Response } from 'express';
import type { z } from 'zod';
import { AppError } from '../lib/app-error';

type Schemas = {
  body?: z.ZodType;
  /** An object schema. Unknown query parameters are rejected (API Spec A2). */
  query?: z.ZodObject;
  params?: z.ZodType;
};

type Parsed<S extends Schemas> = {
  [K in keyof S]: S[K] extends z.ZodType ? z.output<S[K]> : never;
};

function fieldsFrom(error: z.ZodError, prefix: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = [prefix, ...issue.path.map(String)].filter(Boolean).join('.');
    fields[path || 'request'] ??= issue.message;
  }
  return fields;
}

/** Parses body, query and path with Zod. Failures become VALIDATION with `fields` keyed by JSON path. */
export function validate<S extends Schemas>(schemas: S): RequestHandler {
  return (req, res, next) => {
    const out: Record<string, unknown> = {};
    const fields: Record<string, string> = {};

    const run = (name: 'body' | 'query' | 'params', schema: z.ZodType | undefined, value: unknown, prefix: string) => {
      if (!schema) return;
      const result = schema.safeParse(value);
      if (result.success) out[name] = result.data;
      else Object.assign(fields, fieldsFrom(result.error, prefix));
    };

    run('body', schemas.body, req.body, '');
    run('query', schemas.query?.strict(), req.query, 'query');
    run('params', schemas.params, req.params, 'params');

    if (Object.keys(fields).length > 0) return next(new AppError('VALIDATION', { fields }));
    res.locals['validated'] = out;
    next();
  };
}

/** The parsed input from the `validate` middleware, typed by the schemas passed to it. */
export function validated<S extends Schemas>(res: Response, _schemas?: S): Parsed<S> {
  return res.locals['validated'] as Parsed<S>;
}
