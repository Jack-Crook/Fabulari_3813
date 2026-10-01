import { emailProblem, passwordProblem, nameProblem, textProblem, ageLimitProblem, dobProblem, firstProblem } from './validation';

// plain functions, no TestBed. the same rules server.js checks, so a form can stop early.
describe('client-side validation', () => {
  it('needs an email in the right shape', () => {
    expect(emailProblem('')).toBe('Email is required');
    expect(emailProblem('not-an-email')).toBe('That is not a valid email address');
    expect(emailProblem(' a@b.com ')).toBeNull();
  });

  it('needs a password of at least 6 characters, unless it is optional and left blank', () => {
    expect(passwordProblem('')).toBe('Password is required');
    expect(passwordProblem('123')).toContain('at least 6');
    expect(passwordProblem('', false)).toBeNull();
    expect(passwordProblem('secret1')).toBeNull();
  });

  it('limits names to 50 characters and requires them unless optional', () => {
    expect(nameProblem('Room name', '  ')).toBe('Room name is required');
    expect(nameProblem('Display name', '', false)).toBeNull();
    expect(nameProblem('Group name', 'n'.repeat(51))).toContain('at most 50');
    expect(nameProblem('Group name', 'Chess')).toBeNull();
  });

  it('limits descriptions and bios to 500 characters', () => {
    expect(textProblem('Bio', 'b'.repeat(501))).toContain('at most 500');
    expect(textProblem('Bio', '')).toBeNull();
  });

  it('accepts a whole-number age limit from 0 to 120', () => {
    expect(ageLimitProblem(0)).toBeNull();
    expect(ageLimitProblem('18')).toBeNull();
    expect(ageLimitProblem(-1)).not.toBeNull();
    expect(ageLimitProblem(121)).not.toBeNull();
    expect(ageLimitProblem(12.5)).not.toBeNull();
  });

  it('accepts no date of birth, refuses a made-up one or one in the future', () => {
    expect(dobProblem('')).toBeNull();
    expect(dobProblem('2000-01-01')).toBeNull();
    expect(dobProblem('yesterday')).toContain('valid date');
    expect(dobProblem('2999-01-01')).toContain('future');
  });

  it('reports the first problem in a list', () => {
    expect(firstProblem(null, 'second', 'third')).toBe('second');
    expect(firstProblem(null, null)).toBeNull();
  });
});
