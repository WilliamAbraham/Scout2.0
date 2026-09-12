import {readFile, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {BrokerEnrichment, parseEmailListing} from '../src/enrichment/service.ts';
import {DATA_DIR, REPO_ROOT} from '../src/paths.ts';

try {process.loadEnvFile(path.join(REPO_ROOT, '.env'));} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
const args = process.argv.slice(2);
const usage = 'Usage: npm run enrich -- <input.json> [--refresh] [--no-index-fallback] [--max-calls N] [--output path]';
if (args.includes('--help')) {console.log(usage); process.exit(0);}
let inputPath: string | undefined, outputPath: string | undefined;
let refresh = false, indexedFallback = true, maxCalls = 32;
for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === '--refresh') refresh = true;
  else if (arg === '--no-index-fallback') indexedFallback = false;
  else if (arg === '--max-calls' || arg === '--output') {
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    if (arg === '--output') outputPath = path.resolve(value);
    else {
      maxCalls = Number(value);
      if (!Number.isInteger(maxCalls) || maxCalls < 1) throw new Error('--max-calls must be a positive integer');
    }
  } else if (arg.startsWith('--') || inputPath) throw new Error(`Unexpected argument: ${arg}\n${usage}`);
  else inputPath = arg;
}
if (!inputPath) throw new Error(usage);
const input = parseEmailListing(JSON.parse(await readFile(inputPath, 'utf8')));
const outputDir = path.join(DATA_DIR, 'enrichment');
const enrichment = new BrokerEnrichment({
  cacheDir: path.join(outputDir, 'cache'), refresh, indexedFallback, maxCalls,
  ...(process.env.TAVILY_API_KEY ? {tavilyKey: process.env.TAVILY_API_KEY} : {}),
  ...(process.env.FIRECRAWL_API_KEY ? {firecrawlKey: process.env.FIRECRAWL_API_KEY} : {}),
  log: message => console.error(message),
});
console.error(`Search provider: ${enrichment.searchProvider}. Reader/extractor: Firecrawl.`);
const result = await enrichment.run(input);
if (result.status === 'error' || result.execution !== 'completed') process.exitCode = 1;
const output = outputPath ?? path.join(outputDir, 'results', `${path.basename(inputPath, '.json')}.result.json`);
await mkdir(path.dirname(output), {recursive: true});
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
console.error(`Saved ${output}`);
