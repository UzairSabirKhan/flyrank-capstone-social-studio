import 'dotenv/config';
import { z } from 'zod';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().url(),
    PUBLISHER: z.enum(['discord', 'mock_x', 'mock_linkedin']).default('mock_x'),
    DISCORD_WEBHOOK_URL: z.string().url().optional(),
    DISCORD_GUILD_ID: z.string().regex(/^\d+$/).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.PUBLISHER === 'discord') {
      if (!v.DISCORD_WEBHOOK_URL) {
        ctx.addIssue({
          code: 'custom',
          path: ['DISCORD_WEBHOOK_URL'],
          message: 'Required when PUBLISHER=discord',
        });
      }
      if (!v.DISCORD_GUILD_ID) {
        ctx.addIssue({
          code: 'custom',
          path: ['DISCORD_GUILD_ID'],
          message: 'Required when PUBLISHER=discord',
        });
      }
    }
  });

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}
