import i18n from '../i18n';
import { ApiError } from './api';

/**
 * Turn any thrown error into one clear sentence for the user, in their language. Server codes
 * map to our own copy (the apiErrors namespace); a code we have no wording for shows the
 * server's message, which is written for people; anything else gets the generic line.
 */
export function humanError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'TIMEOUT') return i18n.t('common.timeout');
    // Network failures happen on loads and saves alike: word it for both.
    if (err.isNetwork) return i18n.t('common.networkBody');
    switch (err.code) {
      case 'INVALID_EMAIL_OR_PASSWORD':
      case 'INVALID_PASSWORD':
        return i18n.t('auth.errors.invalidLogin');
      case 'INVALID_OTP':
      case 'OTP_EXPIRED':
        return i18n.t('auth.errors.wrongCode');
      case 'TOO_MANY_ATTEMPTS':
      case 'RATE_LIMITED':
      case 'HTTP_429':
        return i18n.t('auth.errors.tooMany');
      case 'USER_ALREADY_EXISTS':
      case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
        return i18n.t('auth.errors.exists');
      case 'VALIDATION_ERROR':
        return validationMessage(err.details) ?? i18n.t('errors.invalid');
      case 'NO_ORGANIZATION':
        return i18n.t('errors.noOrganization');
      case 'DATE_IN_PAST':
        return i18n.t('errors.dateInPast');
      case 'ALREADY_BUSINESS_BUYER':
        return i18n.t('setup.errors.alreadyBusiness');
      case 'ALREADY_HOUSEHOLD_BUYER':
        return i18n.t('setup.errors.alreadyHousehold');
      case 'ROLE_ALREADY_SET':
        return i18n.t('setup.errors.roleSet');
      default:
        // Any code with our own wording (en and sw) wins; otherwise the server's sentence.
        return i18n.t(`apiErrors.${err.code}`, {
          defaultValue: err.message || i18n.t('auth.errors.generic'),
        });
    }
  }
  return i18n.t('auth.errors.generic');
}

type Issue = { path?: string; code?: string; message?: string };

/** Problem wording by zod issue code (the API sends codes; the words are ours, QA-032). */
const ISSUE_KEYS: Record<string, string> = {
  too_small: 'errors.issue.tooSmall',
  too_big: 'errors.issue.tooBig',
  invalid_type: 'errors.issue.required',
  invalid_format: 'errors.issue.format',
  invalid_string: 'errors.issue.format',
  invalid_value: 'errors.issue.choice',
  invalid_enum_value: 'errors.issue.choice',
  not_multiple_of: 'errors.issue.format',
};

/** First validation issue as one sentence in the user's language, naming the field. */
export function validationMessage(details: unknown): string | null {
  const issues = (details as { issues?: Issue[] } | undefined)?.issues;
  const first = issues?.[0];
  if (!first) return null;
  const key = (first.path ?? '')
    .replace(/^\//, '')
    .split(/[./]/)
    .filter((x) => x && !/^\d+$/.test(x))
    .pop();
  const field = key ? i18n.t(`errors.field.${key}`, { defaultValue: humanize(key) }) : '';
  const problem = i18n.t(ISSUE_KEYS[first.code ?? ''] ?? 'errors.issue.invalid');
  return field ? i18n.t('errors.fieldProblem', { field, problem }) : problem;
}

/** Field errors keyed by the last path segment, for forms that show them inline. */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || err.code !== 'VALIDATION_ERROR') return {};
  const out: Record<string, string> = {};
  for (const issue of (err.details as { issues?: Issue[] })?.issues ?? []) {
    const key = (issue.path ?? '')
      .replace(/^\//, '')
      .split(/[./]/)
      .filter((x) => x && !/^\d+$/.test(x))
      .pop();
    if (key && !out[key]) out[key] = i18n.t(ISSUE_KEYS[issue.code ?? ''] ?? 'errors.issue.invalid');
  }
  return out;
}

function humanize(key: string) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .toLowerCase()
    .trim();
}
