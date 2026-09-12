import process from 'node:process';

import {chromium, type Browser, type Page} from 'playwright';

// Set HEADLESS=0 to watch a run in a real window while developing a scraper.

// const HEADLESS = process.env.HEADLESS !== '0';
const HEADLESS=true

// Listing pages are ad-heavy and can hang well past Playwright's 30s default.
const TIMEOUT_MS = 20_000;

// One browser is shared by every page — launching is the slow part, and
// enrichment visits many listings in a row.
let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({headless: HEADLESS});
  }
  return browser;
}

/**
 * Run `work` against a fresh page, then close it and everything it owns.
 *
 * Each call gets its own context, so cookies and storage from one listing
 * never leak into the next.
 */
export async function withPage<T>(
  work: (page: Page) => Promise<T>,
): Promise<T> {
  const context = await (await getBrowser()).newContext();
  context.setDefaultTimeout(TIMEOUT_MS);

  const page = await context.newPage();
  try {
    return await work(page);
  } finally {
    await context.close();
  }
}

/**
 * Shut the shared browser down. Nothing else closes it, so a script that
 * used withPage must call this or the process will not exit.
 */
export async function closeBrowser(): Promise<void> {
  await browser?.close();
  browser = null;
}
