import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {enrichWithAgent, AGENT_MODEL} from '../src/enrichment/agent.ts';
import {EnrichmentBudget} from '../src/enrichment/spend.ts';
import {parseEmailListing} from '../src/enrichment/service.ts';
import {REPO_ROOT, DATA_DIR} from '../src/paths.ts';

try {process.loadEnvFile(path.join(REPO_ROOT, '.env'));} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
const args = process.argv.slice(2);
const usage = 'npm run enrich:agent -- input.json [--budget-usd amount] [--output directory] [--refresh] [--screenshot listing.png]. Paid requests require an explicit budget; the default is $0.';
if (args.includes('--help')) {console.log(usage); process.exit(0);}
const inputFile = args.shift();
if (!inputFile || inputFile.startsWith('--')) throw new Error(usage);
let model = process.env.OPENROUTER_MODEL ?? AGENT_MODEL;
let output = path.join(DATA_DIR, 'enrichment', 'agent-tests', new Date().toISOString().replaceAll(':', '-'));
let searchEngine: 'exa' | 'parallel' | 'perplexity' | 'native' = 'parallel';
let screenshotPath: string | undefined;
let budgetUsd = 0, refresh = false;
while (args.length) {
  const flag = args.shift();
  if (flag === '--refresh') {refresh = true; continue;}
  const value = args.shift();
  if (!value || value.startsWith('--')) throw new Error(usage);
  if (flag === '--model') model = value;
  else if (flag === '--output') output = path.resolve(value);
  else if (flag === '--screenshot') screenshotPath = path.resolve(value);
  else if (flag === '--budget-usd') budgetUsd = Number(value);
  else if (flag === '--engine' && ['exa', 'parallel', 'perplexity', 'native'].includes(value)) searchEngine = value as typeof searchEngine;
  else throw new Error(usage);
}
const apiKey = process.env.OPENROUTER_API_KEY ?? '';
const budget = new EnrichmentBudget(budgetUsd);
const json: unknown = JSON.parse(await readFile(inputFile, 'utf8'));
const inputs = (Array.isArray(json) ? json : [json]).map(parseEmailListing);
let listingImage: {dataUrl: string; sourceId: string} | undefined;
if (screenshotPath) {
  if (inputs.length !== 1) throw new Error('--screenshot requires exactly one listing');
  const mime = ({'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp'} as Record<string, string>)[path.extname(screenshotPath).toLowerCase()];
  const bytes = await readFile(screenshotPath);
  if (!mime || bytes.length > 20 * 1024 * 1024) throw new Error('Use a PNG, JPEG, or WebP listing screenshot under 20 MB');
  listingImage = {dataUrl: `data:${mime};base64,${bytes.toString('base64')}`, sourceId: 'attachment://listing-screenshot'};
}
await mkdir(output, {recursive: true});
const results = [];
for (const [index, input] of inputs.entries()) {
  const result = await enrichWithAgent(input, {apiKey, model, searchEngine, log: console.error,
    budget, refresh, cacheDir: path.join(DATA_DIR, 'enrichment', 'agent-cache'),
    ...(listingImage ? {listingImage} : {}),
    save: async (stage, checkpoint, raw) => {
      await writeFile(path.join(output, `${index + 1}-${stage}.raw.json`), JSON.stringify(raw, null, 2));
      await writeFile(path.join(output, `${index + 1}.result.json`), JSON.stringify(checkpoint, null, 2));
    },
  });
  results.push(result);
  await writeFile(path.join(output, `${index + 1}.result.json`), JSON.stringify(result, null, 2));
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  await writeFile(path.join(output, 'budget.json'), JSON.stringify(budget, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (result.execution !== 'completed') process.exitCode = 1;
  if (result.notes.some(n => /OpenRouter HTTP (401|402|403|429)/.test(n))) break;
}
console.error(`Saved results and provider transcripts in ${output}`);
console.error(`API-reported spend: $${budget.reportedUsd.toFixed(4)}; budget: $${budget.limitUsd.toFixed(4)}${budget.haltedReason ? `; ${budget.haltedReason}` : ''}`);
