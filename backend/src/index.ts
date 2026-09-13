import http from 'node:http';
import process from 'node:process';

// Overridable so the frontend dev server and this one can coexist.
const PORT = Number(process.env.PORT ?? 3000);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let refreshInFlight: Promise<unknown> | null = null;

function readJson(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(
          parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : {},
        );
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function send(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {'Content-Type': 'application/json'});
  response.end(JSON.stringify(body));
}

/**
 * The backend HTTP server.
 *
 * `/health` stays cheap. `POST /refresh-listings` re-parses stored alert ids
 * and enriches only new matches. Status lines go to stderr so a terminal
 * attached to this process can watch enrichment happen.
 */
async function handle(
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<void> {
  const url = request.url ?? '/';
  if (url === '/health') {
    send(response, 200, {status: 'ok'});
    return;
  }

  if (request.method === 'POST' && url === '/refresh-listings') {
    if (refreshInFlight) {
      send(response, 409, {error: 'A listings refresh is already running. Watch that terminal.'});
      return;
    }
    const body = await readJson(request);
    const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
    if (!uuid.test(userId)) {
      send(response, 400, {error: 'Sign in to refresh listings.'});
      return;
    }
    const {runRefreshListings} = await import('./pipeline/refreshRun.ts');
    refreshInFlight = runRefreshListings(userId, line => {
      console.error(`[refresh] ${line}`);
    });
    try {
      const report = await refreshInFlight;
      send(response, 200, report);
    } finally {
      refreshInFlight = null;
    }
    return;
  }

  send(response, 404, {error: 'Not found'});
}

const server = http.createServer((request, response) => {
  handle(request, response).catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[refresh] ${message}`);
    if (!response.headersSent) send(response, 500, {error: message});
    else response.end();
  });
});

server.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
  console.error('[refresh] POST /refresh-listings to reparse stored alerts');
});
