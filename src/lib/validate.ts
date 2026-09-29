import { z } from 'zod';
import { HttpError } from './errors';

export function parseOrThrow<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid request', details);
  }
  return result.data;
}
