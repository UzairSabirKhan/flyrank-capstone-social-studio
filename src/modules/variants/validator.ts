import { graphemeLength, graphemes } from '../../lib/text';
import type { ConstraintProfile } from './profiles';

export type ViolationCode =
  | 'TOO_LONG'
  | 'TOO_SHORT'
  | 'TOO_FEW_HASHTAGS'
  | 'TOO_MANY_HASHTAGS'
  | 'TOO_MANY_EXCLAMATIONS'
  | 'TOO_MANY_EMOJI'
  | 'BANNED_PHRASE';

export interface Violation {
  code: ViolationCode;
  message: string;
}

const HASHTAG = /(?:^|\s)#[\p{L}\p{N}_]+/gu;
const PICTOGRAPH = /\p{Extended_Pictographic}/u;

export function validateVariant(profile: ConstraintProfile, text: string): Violation[] {
  const violations: Violation[] = [];
  const name = profile.platform;

  const length = graphemeLength(text);
  if (length > profile.maxGraphemes) {
    violations.push({
      code: 'TOO_LONG',
      message: `${name}: ${length} characters, maximum is ${profile.maxGraphemes}`,
    });
  }
  if (length < profile.minGraphemes) {
    violations.push({
      code: 'TOO_SHORT',
      message: `${name}: ${length} characters, minimum is ${profile.minGraphemes}`,
    });
  }

  const hashtags = text.match(HASHTAG)?.length ?? 0;
  if (hashtags > profile.maxHashtags) {
    violations.push({
      code: 'TOO_MANY_HASHTAGS',
      message: `${name}: ${hashtags} hashtags, maximum is ${profile.maxHashtags}`,
    });
  }
  if (hashtags < profile.minHashtags) {
    violations.push({
      code: 'TOO_FEW_HASHTAGS',
      message: `${name}: ${hashtags} hashtags, minimum is ${profile.minHashtags}`,
    });
  }

  const exclamations = (text.match(/!/g) ?? []).length;
  if (exclamations > profile.maxExclamations) {
    violations.push({
      code: 'TOO_MANY_EXCLAMATIONS',
      message: `${name}: ${exclamations} exclamation marks, maximum is ${profile.maxExclamations}`,
    });
  }

  const emoji = graphemes(text).filter((g) => PICTOGRAPH.test(g)).length;
  if (emoji > profile.maxEmoji) {
    violations.push({
      code: 'TOO_MANY_EMOJI',
      message: `${name}: ${emoji} emoji, maximum is ${profile.maxEmoji}`,
    });
  }

  const lower = text.toLowerCase();
  for (const phrase of profile.bannedPhrases) {
    if (lower.includes(phrase)) {
      violations.push({ code: 'BANNED_PHRASE', message: `${name}: contains "${phrase}"` });
    }
  }

  return violations;
}
