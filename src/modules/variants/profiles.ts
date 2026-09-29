export const PLATFORMS = ['x', 'linkedin'] as const;
export type Platform = (typeof PLATFORMS)[number];

export interface ConstraintProfile {
  platform: Platform;
  minGraphemes: number;
  maxGraphemes: number;
  minHashtags: number;
  maxHashtags: number;
  maxExclamations: number;
  maxEmoji: number;
  bannedPhrases: string[];
}

const BANNED = ['click here', "you won't believe", 'link in bio', 'smash that', 'follow for more'];

export const PROFILES: Record<Platform, ConstraintProfile> = {
  x: {
    platform: 'x',
    minGraphemes: 10,
    maxGraphemes: 280,
    minHashtags: 0,
    maxHashtags: 2,
    maxExclamations: 1,
    maxEmoji: 3,
    bannedPhrases: BANNED,
  },
  linkedin: {
    platform: 'linkedin',
    minGraphemes: 80,
    maxGraphemes: 3000,
    minHashtags: 3,
    maxHashtags: 5,
    maxExclamations: 1,
    maxEmoji: 2,
    bannedPhrases: BANNED,
  },
};
