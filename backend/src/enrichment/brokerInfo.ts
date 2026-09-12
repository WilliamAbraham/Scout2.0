import type {Page} from 'playwright';

// Enough of the markup to recognize an element, without dumping a whole
// listing page into the terminal.
const HTML_PREVIEW = 200;

/**
 * Everything worth reading off a single matched element. Whichever field
 * holds the value you want tells you what to call on the locator:
 * `text` -> .textContent(), `innerText` -> .innerText(), an entry in
 * `attributes` -> .getAttribute(name).
 */
export interface LocatorFields {
  index: number;
  tag: string;
  text: string | null;
  innerText: string;
  html: string;
  attributes: Record<string, string>;
  visible: boolean;
}

/**
 * Describe every element a selector matches, so a selector can be checked
 * against a real page before any parser commits to it.
 *
 * Returns one entry per match, in document order, and an empty array when
 * the selector matches nothing — it never throws for a bad selector.
 */
export async function locatorFields(
  page: Page,
  query: string,
): Promise<LocatorFields[]> {
  return page.locator(query).evaluateAll((elements, preview) => {
    return elements.map((element, index) => {
      const attributes: Record<string, string> = {};
      for (const attribute of element.attributes) {
        attributes[attribute.name] = attribute.value;
      }

      const html = element.innerHTML;
      const rect = element.getBoundingClientRect();

      return {
        index,
        tag: element.tagName.toLowerCase(),
        // Collapse whitespace — markup indentation otherwise buries the value.
        text: element.textContent?.replace(/\s+/g, ' ').trim() ?? null,
        // Cast structurally: the backend's tsconfig has no DOM lib, and
        // SVGElement (the other half of Playwright's union) has no innerText.
        innerText: ((element as {innerText?: string}).innerText ?? '')
          .replace(/\s+/g, ' ')
          .trim(),
        html: html.length > preview ? `${html.slice(0, preview)}…` : html,
        attributes,
        visible: rect.width > 0 && rect.height > 0,
      };
    });
  }, HTML_PREVIEW);
}
