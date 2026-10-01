// client-side checks, the same rules server.js enforces. forms run these before sending, so the
// user is told straight away what to fix without a round trip. the server still checks everything,
// because code running in the browser can be bypassed.
//
// each returns why the value is refused, or null when it's fine. plain functions with no angular in
// them, like theme.ts, so they're easy to test.

export const MAX_NAME = 50;       // group, room and display names
export const MAX_TEXT = 500;      // descriptions and bios

// the same shape check as the server: something@something.something
export function emailProblem(email: string): string | null {
  const clean = (email ?? '').trim();
  if (!clean) {
    return 'Email is required';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    return 'That is not a valid email address';
  }
  return null;
}

// required on login and register. on the profile page a blank password means "keep the old one",
// so it's only checked when one was typed.
export function passwordProblem(password: string, required = true): string | null {
  if (!password) {
    return required ? 'Password is required' : null;
  }
  if (password.length < 6) {
    return 'Password must be at least 6 characters';
  }
  return null;
}

// a group, room or display name. `label` starts the message, e.g. 'Group name'.
export function nameProblem(label: string, name: string, required = true): string | null {
  const clean = (name ?? '').trim();
  if (!clean) {
    return required ? `${label} is required` : null;
  }
  if (clean.length > MAX_NAME) {
    return `${label} can be at most ${MAX_NAME} characters`;
  }
  return null;
}

// a description or bio
export function textProblem(label: string, text: string): string | null {
  return (text ?? '').length > MAX_TEXT ? `${label} can be at most ${MAX_TEXT} characters` : null;
}

// 0 (no limit) to 120, whole years only
export function ageLimitProblem(value: number | string): string | null {
  const years = Number(value);
  return Number.isInteger(years) && years >= 0 && years <= 120
    ? null
    : 'Age limit must be a whole number from 0 to 120';
}

// '' is fine (not set). anything else has to be a real date that isn't in the future.
export function dobProblem(dob: string): string | null {
  if (!dob) {
    return null;
  }
  const born = new Date(dob);
  if (isNaN(born.getTime())) {
    return 'That is not a valid date of birth';
  }
  if (born.getTime() > Date.now()) {
    return 'Date of birth can\'t be in the future';
  }
  return null;
}

// the first problem in a list, so a form can check every field in one line
export function firstProblem(...problems: (string | null)[]): string | null {
  return problems.find(problem => problem !== null) ?? null;
}
