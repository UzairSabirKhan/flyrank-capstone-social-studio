import { prisma } from '../lib/db';
import { isUniqueViolation } from '../lib/prismaErrors';
import { graphemeLength } from '../lib/text';
import type { PublishInput, PublishResult, SocialPublisher } from './SocialPublisher';

export class MockPublisher implements SocialPublisher {
  readonly dedupesByKey = true; // MockPost.idempotencyKey is UNIQUE

  constructor(
    readonly name: string,
    private readonly label: string,
  ) {}

  async publish({ text, idempotencyKey }: PublishInput): Promise<PublishResult> {
    try {
      const post = await prisma.mockPost.create({
        data: { platform: this.name, text, preview: this.preview(text), idempotencyKey },
      });
      return { externalId: post.id, url: null };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const existing = await prisma.mockPost.findUniqueOrThrow({ where: { idempotencyKey } });
      return { externalId: existing.id, url: null }; // same key, same post
    }
  }

  private preview(text: string): string {
    return `[MOCK ${this.label}] would post ${graphemeLength(text)} characters:\n\n${text}`;
  }
}

export class MockXPublisher extends MockPublisher {
  constructor() {
    super('mock_x', 'X');
  }
}

export class MockLinkedInPublisher extends MockPublisher {
  constructor() {
    super('mock_linkedin', 'LinkedIn');
  }
}
