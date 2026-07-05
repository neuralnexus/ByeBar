export const DEFAULT_SETTINGS = {
  enabled: true,
  genericBlocking: true,
  cookieDecline: true,
  siteOverrides: {}
};

export const SUBSTACK_HOST_PATTERNS = [/\.substack\.com$/i, /^substack\.com$/i];

export const COOKIE_DECLINE_TEXT = [
  /^reject(\s+all)?$/i,
  /^decline(\s+all)?$/i,
  /^deny(\s+all)?$/i,
  /^refuse(\s+all)?$/i,
  /^opt[-\s]?out$/i,
  /^do not sell/i,
  /^required cookies only$/i,
  /^only\s+(essential|necessary|required)(\s+cookies)?$/i,
  /^essential\s+only$/i,
  /^necessary\s+only$/i,
  /^no\s+thanks$/i,
  /^dismiss$/i,
  /^close$/i
];

export const COOKIE_LANGUAGE_RE =
  /about cookies on this site|to opt-?out of us sharing|third parties for advertising|your privacy rights|cookie preferences|privacy law|personal information|opt-?out|do not sell|similar technologies|required\)\./i;

export const COOKIE_ACTION_RE =
  /accept( and proceed| all)?|opt-?out|more info|reject|decline|manage preferences|do not sell or share/i;

export const OVERLAY_KEYWORDS_RE =
  /subscribe|newsletter|sign\s*up|email\s*list|get\s+\d+%|discount|coupon|off\s+your|join\s+our/i;
