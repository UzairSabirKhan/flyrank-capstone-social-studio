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
    /** Demo only: sleep after each send, to make a crash window wide enough to hit. */
    PUBLISH_DELAY_MS: z.coerce.number().int().min(0).default(0),
    /** A 'publishing' slot older than this is treated as abandoned. Keep it above the slowest publish. */
    STALE_AFTER_SECONDS: z.coerce.number().int().positive().default(120),
  })
  .superRefine((v, ctx) => {
    if (v.PUBLISHER === 'discord') {
      for (const key of ['DISCORD_WEBHOOK_URL', 'DISCORD_GUILD_ID'] as const) {
        if (!v[key]) {
          ctx.addIssue({ code: 'custom', path: [key], message: 'Required when PUBLISHER=discord' });
        }
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
