import { describe, it, expect } from 'vitest';
import { PROFILES, type Platform } from '../src/modules/variants/profiles';
import { validateVariant } from '../src/modules/variants/validator';

const codes = (platform: Platform, text: string) =>
  validateVariant(PROFILES[platform], text).map((v) => v.code);

describe('X profile', () => {
  it('accepts a valid post', () => {
    expect(codes('x', 'A short, honest post about testing. #Testing')).toEqual([]);
  });

  it('blocks text over 280 characters', () => {
    expect(codes('x', 'a'.repeat(281))).toContain('TOO_LONG');
  });

  it('counts an emoji sequence as one grapheme, not many', () => {
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
    const text = family.repeat(100); // 100 graphemes, 800 UTF-16 units
    expect(text.length).toBeGreaterThan(280);
    expect(codes('x', text)).not.toContain('TOO_LONG');
  });

  it('blocks more than 2 hashtags', () => {
    expect(codes('x', 'Lots of tags here #One #Two #Three')).toContain('TOO_MANY_HASHTAGS');
  });

  it('blocks banned phrases', () => {
    expect(codes('x', "You won't believe this trick #Tips")).toContain('BANNED_PHRASE');
  });

  it('blocks more than one exclamation mark', () => {
    expect(codes('x', 'Wow! Amazing! Read this now #Tips')).toContain('TOO_MANY_EXCLAMATIONS');
  });
});

describe('LinkedIn profile', () => {
  it('requires at least 3 hashtags', () => {
    expect(codes('linkedin', 'x'.repeat(100) + ' #One')).toContain('TOO_FEW_HASHTAGS');
  });

  it('blocks text over 3000 characters', () => {
    expect(codes('linkedin', 'a'.repeat(3001) + ' #A #B #C')).toContain('TOO_LONG');
  });
});
