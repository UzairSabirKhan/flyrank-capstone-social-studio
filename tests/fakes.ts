import type {
  PublishError,
  PublishInput,
  PublishResult,
  SocialPublisher,
} from '../src/adapters/SocialPublisher';

/** Deliberately NOT idempotent, so the tests prove the claim does the protecting. */
export class CountingPublisher implements SocialPublisher {
  readonly name = 'counting';
  readonly dedupesByKey = false;
  readonly calls: PublishInput[] = [];

  constructor(private readonly failWith?: PublishError) {}

  async publish(input: PublishInput): Promise<PublishResult> {
    this.calls.push(input);
    await new Promise((resolve) => setTimeout(resolve, 50)); // widen the race window
    if (this.failWith) throw this.failWith;
    return { externalId: `fake-${this.calls.length}`, url: null };
  }
}
