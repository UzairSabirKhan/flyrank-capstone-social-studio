import { describe, it, expect } from 'vitest';
import { GENERATORS } from '../src/modules/variants/generators';
import { PROFILES } from '../src/modules/variants/profiles';
import { validateVariant } from '../src/modules/variants/validator';

const post = {
  title: 'Why Idempotency Matters for Publishing Systems',
  sourceUrl: 'https://example.com/idempotency',
  bodyMarkdown: `# Idempotency

Publishing systems retry on failure. A retry after a timeout must never create a second post.
Idempotency keys let the server recognise a repeated request and ignore it. This is why the
database, not the application code, should enforce uniqueness. Teams that skip this step end up
with duplicate posts and angry customers.`,
};

describe('template generators', () => {
  it('produces two different variants that both pass their profile', () => {
    const x = GENERATORS.x(post);
    const linkedin = GENERATORS.linkedin(post);
    expect(x).not.toEqual(linkedin);
    expect(validateVariant(PROFILES.x, x)).toEqual([]);
    expect(validateVariant(PROFILES.linkedin, linkedin)).toEqual([]);
  });

  it('is deterministic', () => {
    expect(GENERATORS.x(post)).toEqual(GENERATORS.x(post));
  });
});
