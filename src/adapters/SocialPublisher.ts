export interface PublishInput {
  text: string;
  idempotencyKey: string;
}

export interface PublishResult {
  externalId: string;
  url: string | null;
}

export interface SocialPublisher {
  readonly name: string;
  /** True if publishing twice with the same key can never create two posts. */
  readonly dedupesByKey: boolean;
  publish(input: PublishInput): Promise<PublishResult>;
}

/**
 * kind 'rejected': the platform definitely did NOT create the post (4xx, rate limit).
 * kind 'unknown':  the post MAY exist (timeout, network error, 5xx).
 */
export class PublishError extends Error {
  constructor(
    message: string,
    public readonly kind: 'rejected' | 'unknown',
  ) {
    super(message);
  }
}
