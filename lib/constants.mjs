export const DEFAULT_SETTINGS = {
  enabled: true,
  genericBlocking: true,
  cookieDecline: true,
  tosAccept: true,
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
  /about cookies on this site|to opt-?out of us sharing|third parties for advertising|your privacy rights|cookie preferences|privacy law|personal information|opt-?out|do not sell|similar technologies|required\)\.|we use cookies|continuing to use this website|condition of use|privacy notice/i;

export const COOKIE_ACTION_RE =
  /accept( and proceed| all)?|opt-?out|more info|reject|decline|manage preferences|do not sell or share/i;

export const COOKIE_IMPLIED_CONSENT_RE =
  /continuing to use|by continuing|agree to this condition|you agree to this/i;

export const OVERLAY_KEYWORDS_RE =
  /subscribe|newsletter|sign\s*up|email\s*list|get\s+\d+%|discount|coupon|off\s+your|join\s+our/i;

export const BLOOMBERG_PROMO_RE =
  /flash sale|save up to \d+%|subscribe for (just )?\$?\d|limited[- ]time offer|get \d+% off|off your first (month|year)|unlock your offer/i;

export const BLOOMBERG_MODULE_VISIBILITY_RE = /_showOn(?:Mobile|Desktop)/;

export const TOS_LANGUAGE_RE =
  /updated our terms|terms of service|terms and conditions|arbitration provision|class action waiver|user agreement|end[- ]user license|license agreement/i;

export const TOS_ACCEPT_TEXT = [
  /^accept$/i,
  /^i agree$/i,
  /^agree$/i,
  /^accept and continue$/i,
  /^got it$/i,
  /^ok$/i,
  /^okay$/i
];
