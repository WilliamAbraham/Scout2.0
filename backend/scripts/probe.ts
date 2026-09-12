import process from 'node:process';

import {closeBrowser, withPage} from '../src/enrichment/browser.ts';
import {locatorFields} from '../src/enrichment/brokerInfo.ts';

// ---------------------------------------------------------------------------
// Hardcode what to look at here, then run: npm run probe -w backend
// ---------------------------------------------------------------------------

const URL = 'https://streeteasy.com/rental/5112698';

const SELECTORS = ['h1', 'p', 'a'];

// ---------------------------------------------------------------------------

/**
 * Load one page and print every field of every element each selector matches,
 * so a selector can be tried against real markup before a parser relies on it.
 *
 *   npm run probe -w backend                          # the constants above
 *   npm run probe -w backend -- <url> <selector>...   # override them
 *   HEADLESS=0 npm run probe -w backend               # watch it in a window
 */
async function probe() {
  const args = process.argv.slice(2);
  const url = args[0] ?? URL;
  const selectors = args.length > 1 ? args.slice(1) : SELECTORS;

  console.log(`# ${url}\n`);

  await withPage(async page => {
    const response = await page.goto(url, {waitUntil: 'domcontentloaded'});
    console.log(`status: ${response?.status() ?? '(none)'}`);
    console.log(`title:  ${await page.title()}\n`);

    for (const selector of selectors) {
      const matches = await locatorFields(page, selector);
      console.log(`## ${selector} — ${matches.length} match(es)`);

      for (const match of matches) {
        const attributes = Object.entries(match.attributes)
          .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
          .join(' ');

        console.log(
          `  [${match.index}] <${match.tag}> visible=${match.visible}`,
        );
        console.log(`      text:  ${JSON.stringify(match.text)}`);
        if (match.innerText !== match.text) {
          console.log(`      inner: ${JSON.stringify(match.innerText)}`);
        }
        if (attributes) {
          console.log(`      attrs: ${attributes}`);
        }
        console.log(`      html:  ${JSON.stringify(match.html)}`);
      }

      console.log();
    }
  });

  await closeBrowser();
}

await probe();
