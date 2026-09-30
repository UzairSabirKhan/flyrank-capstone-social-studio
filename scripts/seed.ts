import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { createPost } from '../src/modules/posts/service';
import { approveVariant } from '../src/modules/review/service';
import { scheduleVariant } from '../src/modules/scheduling/service';
import { generateVariants } from '../src/modules/variants/service';

const post = await createPost({
  sourceType: 'markdown',
  title: 'Why Idempotency Matters',
  markdown:
    'Publishing systems retry on failure. A retry after a timeout must never create a second post. ' +
    'Idempotency keys let the server recognise a repeated request and ignore it. ' +
    'The database should enforce uniqueness, not application code.',
});
const { created } = await generateVariants(post.id, ['x', 'linkedin']);

const x = created.find((v) => v.platform === 'x')!;
await approveVariant(x.id); // the LinkedIn variant stays a draft, ready for review
const { slot } = await scheduleVariant(x.id, new Date(Date.now() + 2 * 60_000));

console.log(`post:     ${post.id}`);
console.log(`variants: ${created.map((v) => `${v.platform}=${v.id}`).join('  ')}`);
console.log(`slot:     ${slot.id} (X variant approved, publishes in about 2-3 minutes)`);
await prisma.$disconnect();
