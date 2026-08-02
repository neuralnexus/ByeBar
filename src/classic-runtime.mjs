import * as bloomberg from '../lib/bloomberg-heuristics.mjs';
import * as chinaCommerce from '../lib/china-commerce-heuristics.mjs';
import * as constants from '../lib/constants.mjs';
import * as cookie from '../lib/cookie-heuristics.mjs';
import * as host from '../lib/host.mjs';
import * as overlay from '../lib/overlay-heuristics.mjs';
import * as safari from '../lib/safari.mjs';
import * as settings from '../lib/settings.mjs';
import * as substack from '../lib/substack-heuristics.mjs';
import * as substackDetect from '../lib/substack-detect.mjs';
import * as text from '../lib/text.mjs';
import * as tos from '../lib/tos-heuristics.mjs';

const BYEBAR = (globalThis.ByeBar ||= {});

BYEBAR.lib = Object.freeze({
  bloomberg,
  chinaCommerce,
  constants,
  cookie,
  host,
  overlay,
  safari,
  settings,
  substack,
  substackDetect,
  text,
  tos
});
BYEBAR.settings = settings;
