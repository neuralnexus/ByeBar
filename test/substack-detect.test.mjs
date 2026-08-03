import { describe, expect, it } from 'vitest';
import {
  isSubstackDom,
  isSubstackHost,
  isSubstackPageHtml,
  isSubstackSite
} from '../lib/substack-detect.mjs';

describe('isSubstackPageHtml', () => {
  it('detects Substack assets and API metadata', () => {
    expect(
      isSubstackPageHtml(
        '<link rel="preconnect" href="https://substackcdn.com" /><meta content="https://noahpinion.substack.com/api/v1/post_preview/1/twitter.jpg"/>'
      )
    ).toBe(true);
    expect(
      isSubstackPageHtml('<meta content="https://noahpinion.substack.com/api/v1/post_preview/1/image.jpg">')
    ).toBe(true);
    expect(isSubstackPageHtml('<a href="https://substack.com/signup">Join</a>')).toBe(false);
    expect(isSubstackPageHtml('<html><body>Hello world</body></html>')).toBe(false);
  });
});

describe('isSubstackDom', () => {
  it('detects Substack assets without trusting generic modal classes', () => {
    expect(
      isSubstackDom({
        querySelector(sel) {
          if (sel.includes('substackcdn.com')) return { nodeType: 1 };
          return null;
        }
      })
    ).toBe(true);

    expect(
      isSubstackDom({
        querySelector(sel) {
          if (sel.includes('modalViewer')) return { nodeType: 1 };
          return null;
        }
      })
    ).toBe(false);

    expect(
      isSubstackDom({
        querySelector(selector) {
          return selector === 'script[src*="substack.com"]' ? { nodeType: 1 } : null;
        }
      })
    ).toBe(false);

    expect(
      isSubstackDom({
        querySelector: () => null
      })
    ).toBe(false);
  });
});

describe('isSubstackSite', () => {
  it('accepts native hosts, custom-domain HTML, and hydrated DOM markers', () => {
    expect(isSubstackSite('matthewivan.substack.com')).toBe(true);
    expect(
      isSubstackSite('noahpinion.blog', { html: '<link href="https://substackcdn.com/main.css">' })
    ).toBe(true);
    expect(isSubstackSite('example.com', { html: '<a href="https://writer.substack.com">Read</a>' })).toBe(
      false
    );
    expect(isSubstackSite('example.com')).toBe(false);
  });
});

describe('isSubstackHost', () => {
  it('still detects native substack domains', () => {
    expect(isSubstackHost('newsletter.substack.com')).toBe(true);
    expect(isSubstackHost('noahpinion.blog')).toBe(false);
  });
});
