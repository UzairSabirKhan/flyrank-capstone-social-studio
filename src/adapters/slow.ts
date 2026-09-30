import type { PublishInput, PublishResult, SocialPublisher } from './SocialPublisher';

export class SlowPublisher implements SocialPublisher {
  constructor(
    private readonly inner: SocialPublisher,
    private readonly delayMs: number,
  ) {}

  get name() {
    return this.inner.name;
  }
  get dedupesByKey() {
    return this.inner.dedupesByKey;
  }
  get maxLength() {
    return this.inner.maxLength;
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const result = await this.inner.publish(input);
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return result;
  }
}
