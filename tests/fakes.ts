import type {
  PublishError,
  PublishInput,
  PublishResult,
  SocialPublisher,
} from '../src/adapters/SocialPublisher';

export class CountingPublisher implements SocialPublisher {
  readonly name = 'counting';
  readonly calls: PublishInput[] = [];

  constructor(
    private readonly failWith?: PublishError,
    readonly dedupesByKey = false,
  ) {}

  async publish(input: PublishInput): Promise<PublishResult> {
    this.calls.push(input);
    await new Promise((resolve) => setTimeout(resolve, 50)); // widen the race window
    if (this.failWith) throw this.failWith;
    return { externalId: `fake-${this.calls.length}`, url: null };
  }
}
