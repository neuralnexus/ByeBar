/**
 * ByeBar selector registry.
 * Site-specific rules run first; generic rules are optional (user setting).
 */
(() => {
  const BYEBAR = (window.ByeBar = window.ByeBar || {});

  BYEBAR.SITE_RULES = {
    chinaCommerce: {
      hosts: BYEBAR.lib.constants.CHINA_COMMERCE_HOST_PATTERNS,
      remove: [
        '.react-responsive-modal-root',
        '.react-responsive-modal-overlay',
        '.react-responsive-modal-container',
        '.c-vue-coupon',
        '.j-vue-coupon-package-container',
        '[class*="lottery" i]',
        '[class*="turntable" i]',
        '[class*="spin-wheel" i]',
        '[class*="spinWheel" i]',
        '[class*="coupon-spin" i]',
        '[class*="couponSpin" i]',
        '[class*="lucky-wheel" i]',
        '[class*="luckyWheel" i]',
        '[class*="fortune-wheel" i]',
        '[class*="vue-coupon" i]',
        '[id*="lottery" i]',
        '[data-testid*="lottery" i]',
        '[data-testid*="spin" i]'
      ]
    },
    bloomberg: {
      hosts: BYEBAR.lib.constants.BLOOMBERG_HOST_PATTERNS,
      remove: [
        '#cmp-consent-modal',
        '[class*="_showOnMobile"]',
        '[class*="_showOnDesktop"]',
        'a[href*="/subscriptions"]:has([class*="_showOnMobile"])',
        'a[href*="/subscriptions"]:has([class*="_showOnDesktop"])'
      ]
    },
    substack: {
      hosts: BYEBAR.lib.constants.SUBSTACK_HOST_PATTERNS,
      remove: [
        '[role="dialog"][aria-label="Subscribe modal"]',
        '[class*="subscribeDialog"]',
        '[class*="subscribeModal"]',
        '[class*="subscribeWidget"]',
        '[class*="subscribe-widget"]',
        '.intro-popup',
        '[class*="intro-popup"]',
        '[class*="IntroPopup"]',
        '[data-intro-popup]',
        '[class*="signupDialog"]',
        '[class*="signupPopup"]',
        '[class*="emailPopup"]',
        '[class*="subscribe-overlay"]',
        '[class*="SubscribeOverlay"]',
        '[role="dialog"][data-testid="modal"]'
      ]
    }
  };

  // Candidate selectors only. engine.js still requires promotional text and overlay geometry.
  BYEBAR.GENERIC_HIDE = [
    '[role="dialog"][aria-label*="subscribe" i]',
    '[role="dialog"][aria-label*="newsletter" i]',
    '[role="dialog"][aria-label*="sign up" i]',
    '[role="dialog"][aria-label*="signup" i]',
    '[role="dialog"][aria-label*="email" i]',
    '[aria-modal="true"][class*="newsletter" i]',
    '[aria-modal="true"][class*="subscribe" i]',
    '[aria-modal="true"][class*="popup" i]',
    '[class*="newsletter-popup" i]',
    '[class*="newsletterPopup" i]',
    '[class*="newsletter-modal" i]',
    '[class*="newsletterModal" i]',
    '[class*="newsletter-overlay" i]',
    '[class*="newsletterOverlay" i]',
    '[class*="subscribe-popup" i]',
    '[class*="subscribePopup" i]',
    '[class*="subscribe-modal" i]',
    '[class*="subscribeModal" i]',
    '[class*="subscribe-overlay" i]',
    '[class*="subscribeOverlay" i]',
    '[class*="subscribe-bar" i]',
    '[class*="subscribeBar" i]',
    '[class*="subscribe-widget" i]',
    '[class*="subscribeWidget" i]',
    '[class*="email-popup" i]',
    '[class*="emailPopup" i]',
    '[class*="email-capture" i]',
    '[class*="emailCapture" i]',
    '[class*="email-signup" i]',
    '[class*="emailSignup" i]',
    '[class*="exit-intent" i]',
    '[class*="exitIntent" i]',
    '[class*="optin" i]',
    '[class*="opt-in" i]',
    '[class*="discount-popup" i]',
    '[class*="discountPopup" i]',
    '[class*="promo-popup" i]',
    '[class*="promoPopup" i]',
    '[class*="coupon-popup" i]',
    '[class*="couponPopup" i]',
    '[id*="newsletter-popup" i]',
    '[id*="newsletter_popup" i]',
    '[id*="subscribe-popup" i]',
    '[id*="email-popup" i]',
    '[data-testid*="newsletter" i]',
    '[data-testid*="subscribe-modal" i]',
    '.klaviyo-form',
    '[class*="klaviyo" i][class*="modal" i]',
    '[class*="mailchimp" i][class*="popup" i]',
    '[class*="om-holder" i]',
    '[class*="optinmonster" i]',
    '[class*="poptin" i]',
    '[class*="privy" i][class*="popup" i]',
    '[class*="sumo" i][class*="popup" i]'
  ];

  BYEBAR.GENERIC_REMOVE = BYEBAR.GENERIC_HIDE.concat([
    '[class*="bottom-bar" i][class*="subscribe" i]',
    '[class*="bottomBar" i][class*="subscribe" i]',
    '[class*="sticky-bar" i][class*="email" i]',
    '[class*="stickyBar" i][class*="email" i]'
  ]);

  BYEBAR.CHINA_COMMERCE_TRIGGERS = BYEBAR.SITE_RULES.chinaCommerce.remove.join(',');

  // Known cookie banner roots used to confirm that decline controls are in CMP UI.
  BYEBAR.COOKIE_HIDE = [
    '#onetrust-banner-sdk',
    '[data-testid="uc-banner"]',
    '[data-testid="uc-overlay"]',
    '[data-testid="uc-first-layer"]',
    '.uc-banner-root',
    '.uc-overlay',
    '#CybotCookiebotDialog',
    '.qc-cmp2-container',
    '#sp-cc',
    '[id^="sp_message_container"]',
    '.sp_message_container',
    'iframe[id^="sp_message_iframe"]',
    '.fc-consent-root',
    '#fc-consent-root',
    '.fc-dialog-container',
    '.fc-dialog-overlay',
    '#iubenda-cs-banner',
    '#termly-code-snippet-support',
    '[data-termly-modal]',
    '.t-consent-banner',
    '[id^="ketch-banner"]',
    '[class*="ketch-banner" i]',
    '#BorlabsCookieBox',
    '.BorlabsCookie',
    '#cmplz-cookiebanner-container',
    '.cmplz-cookiebanner',
    '#moove_gdpr_cookie_info_bar',
    '#moove_gdpr_cookie_modal',
    '#cookie-notice',
    '#cmpbox',
    '#cmpbox2',
    '.cmpwrapper',
    'iframe[src*="consent.cookiebot.com" i]',
    'iframe[src*="fundingchoicesmessages.google.com" i]',
    '#cookieConsent',
    '#cookie-consent',
    '#cookie-banner',
    '#cookieBanner',
    '#gdpr-cookie-message',
    '#gdpr-consent',
    '#cookiescript_injected',
    '#cookiescript_injected_wrapper',
    '#cookie-law-info-bar',
    '.cc-window',
    '.cc-banner',
    '.cookie-notice',
    '.cookie-notice-container',
    '.cookie-banner',
    '.cookie-consent',
    '.cookies-banner',
    '.cky-consent-container',
    '.cky-banner-element',
    '.cky-overlay',
    '[data-cky-tag="notice"]',
    '[data-cky-tag="detail"]',
    '[data-cky-tag="optout-popup"]',
    'iframe[src*="cookieyes.com" i]',
    '#consent_blackbar',
    '#trustarc-banner-overlay',
    '#truste-consent-track',
    '#truste-consent-content',
    '.truste-banner',
    '.truste_box',
    '.truste-box',
    'iframe[src*="trustarc.com" i]',
    'iframe[src*="consent.trustarc.com" i]',
    'iframe[src*="consent-pref.trustarc.com" i]',
    '[aria-label*="cookie" i][role="dialog"]',
    '#didomi-popup',
    '.didomi-popup-backdrop',
    '.didomi-popup-notice',
    '.didomi-notice-popup',
    '.didomi-screen-medium',
    '.didomi-screen-small',
    '.didomi-screen-large',
    '[class*="didomi-consent-popup" i]',
    '[class*="didomi-popup" i]',
    'iframe[src*="didomi.io" i]'
  ];

  BYEBAR.COOKIE_BANNER_ANCESTORS =
    BYEBAR.COOKIE_HIDE.join(',') +
    ',[data-cky-tag],[class*="sp_message" i],[class*="fc-consent" i],[class*="fc-dialog" i]';

  // Known decline / reject buttons (clicked before hide).
  BYEBAR.COOKIE_DECLINE_SELECTORS = [
    '[data-cky-tag="reject-button"]',
    '[data-cky-tag="detail-reject-button"]',
    '#truste-ccpa-optout',
    '#onetrust-reject-all-handler',
    'button[data-testid="uc-deny-all-button"]',
    'button[data-testid="uc-reject-all-button"]',
    '#uc-deny-all-button',
    '#uc-reject-all-button',
    '#CybotCookiebotDialogBodyButtonDecline',
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll',
    'button[data-cookiefirst-action="decline"]',
    'button[data-testid="cookie-decline"]',
    '.qc-cmp2-summary-buttons button[mode="secondary"]',
    '#cookiescript_reject',
    '#cookie_action_close_header_reject',
    '#cookie_action_close_header_decline',
    '.cc-deny',
    '.cc-reject',
    '.opt-out-button',
    'button.opt-out-button',
    '#truste-consent-required',
    'button.truste-button.opt-out-button',
    '#didomi-notice-disagree-button',
    '#btn-toggle-disagree',
    '.didomi-continue-without-agreeing',
    'button[onclick*="setUserDisagreeToAll" i]',
    'a[href*="setUserDisagreeToAll" i]',
    'button[aria-label*="Disagree to all" i]',
    'button[aria-label*="Refuser" i]',
    'button[aria-label*="refuser" i]',
    'button.sp_choice_type_11',
    'button.sp_choice_type_REJECT_ALL',
    'button[title="Reject All"]',
    'button[title="Reject all"]',
    'button[title="Do not sell or share my personal information"]',
    '.fc-cta-do-not-consent',
    'button.fc-cta-do-not-consent',
    'button.iubenda-cs-reject-btn',
    'button.iub-cmp-reject-btn',
    '#ketch-banner-button-secondary',
    'button#ketch-banner-button-secondary',
    '.cmplz-deny',
    'button.cmplz-deny',
    '.brlbs-btn-deny',
    '[class*="brlbs-btn-deny" i]',
    '.moove-gdpr-infobar-reject-btn',
    '.cn-reject-cookie',
    '#cmpbox .cmpboxbtnno',
    'a.cmpboxbtnno',
    '.qc-cmp2-buttons button[mode="secondary"]'
  ];

  // Terms-of-service / legal modals (tos.js clicks accept when possible).
  BYEBAR.TOS_HIDE = [
    '#cmp-consent-modal',
    '[class*="tos-modal" i]',
    '[class*="terms-modal" i]',
    '[class*="TosModal" i]',
    '[class*="TermsModal" i]',
    '[id*="tos-modal" i]',
    '[id*="terms-modal" i]',
    '[id*="tos_modal" i]',
    '[id*="terms_modal" i]',
    '[data-testid*="tos-modal" i]',
    '[aria-label*="terms of service" i][role="dialog"]',
    '[aria-label*="updated terms" i][role="dialog"]'
  ];

  BYEBAR.TOS_BANNER_ANCESTORS =
    BYEBAR.TOS_HIDE.join(',') +
    ',[class*="tos" i][class*="modal" i],[class*="terms" i][class*="modal" i],[id*="tos" i][role="dialog"],[id*="terms" i][role="dialog"]';

  BYEBAR.TOS_ACCEPT_SELECTORS = ['#cmp-consent-button', '#cmp-consent-modal #cmp-consent-button'];

  BYEBAR.TOS_ACCEPT_TEXT = BYEBAR.lib.constants.TOS_ACCEPT_TEXT;
  BYEBAR.COOKIE_DECLINE_TEXT = BYEBAR.lib.constants.COOKIE_DECLINE_TEXT;

  BYEBAR.isSubstack = () => BYEBAR.substackDetect.detectSubstackPage();

  BYEBAR.isBloomberg = () => BYEBAR.SITE_RULES.bloomberg.hosts.some((re) => re.test(location.hostname));
  BYEBAR.isChinaCommerce = () =>
    BYEBAR.SITE_RULES.chinaCommerce.hosts.some((re) => re.test(location.hostname));
})();
