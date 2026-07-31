import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readProjectFile = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('extension scope', () => {
  it('uses CSS only for elements confirmed by JavaScript', () => {
    const css = readProjectFile('content/styles.css');
    expect(css).toContain('[data-byebar-hidden]');
    expect(css).not.toMatch(/newsletter|subscribe|cookie|paywall|didomi/i);
  });

  it('does not ship unrelated page API patches or redirectors', () => {
    const manifest = JSON.parse(readProjectFile('manifest.json'));
    const scripts = manifest.content_scripts.flatMap((entry) => entry.js || []);
    expect(scripts).not.toContain('content/geolocation.js');
    expect(scripts).not.toContain('content/netsuite-lead.js');
  });

  it('does not include paywalls or legal navigation in removal candidates', () => {
    const selectors = readProjectFile('content/selectors.js');
    expect(selectors).not.toMatch(/\[class\*="paywall"/i);
    expect(selectors).not.toContain('c4d-legal-nav');
    expect(selectors).not.toContain('onetrust-pc-btn-handler');
    expect(selectors).not.toContain('ot-pc-refuse-all-handler');
    expect(selectors).not.toContain('revisit-consent');
  });

  it('does not permanently delete matched page elements', () => {
    const scripts = [
      'content/engine.js',
      'content/cookies.js',
      'content/tos.js',
      'content/china-commerce.js'
    ].map(readProjectFile);

    scripts.forEach((source) => {
      expect(source).not.toMatch(/\.remove\s*\(/);
      expect(source).not.toContain('removeChild(');
    });
  });

  it('does not force-hide locked modals or consent/legal dialogs', () => {
    const engine = readProjectFile('content/engine.js');
    const cookies = readProjectFile('content/cookies.js');
    const tos = readProjectFile('content/tos.js');
    expect(engine).toContain('isModal(el) || blocksPageScroll(el) || pageHasInteractionLock()');
    expect(cookies).not.toContain('visibility.hide(');
    expect(tos).not.toContain('visibility.hide(');
    expect(cookies).toContain('rect.left < window.innerWidth');
    expect(tos).toContain('rect.left < window.innerWidth');
  });

  it('leaves dialogs opened by a real user gesture alone', () => {
    const engine = readProjectFile('content/engine.js');
    expect(engine).toContain('event.isTrusted');
    expect(engine).toContain('userAllowed.add(candidate)');
  });

  it('uses reversible inline hiding for open shadow roots', () => {
    const visibility = readProjectFile('content/visibility.js');
    expect(visibility).toContain('root.nodeType !== 11');
    expect(visibility).toContain("setProperty('display', 'none', 'important')");
    expect(visibility).toContain('restoreShadowDisplay(el)');
    expect(visibility).toContain('ensureHidden');
  });

  it('watches class and style activation in light and shadow DOM', () => {
    const shadow = readProjectFile('content/shadow.js');
    expect(shadow).toContain("'class'");
    expect(shadow).toContain("'hidden'");
    expect(shadow).toContain("'style'");
  });
});
