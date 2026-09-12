import http from 'node:http';
import process from 'node:process';

// Overridable so the frontend dev server and this one can coexist.
const PORT = Number(process.env.PORT ?? 3000);

/**
 * The backend HTTP server.
 *
 * Only /health is wired up so far — the listing pipeline still runs from the
 * scripts in src/scripts/. Routes that expose it belong here as they land.
 */
const server = http.createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, {'Content-Type': 'application/json'});
    response.end(JSON.stringify({status: 'ok'}));
    return;
  }

  response.writeHead(404, {'Content-Type': 'application/json'});
  response.end(JSON.stringify({error: 'Not found'}));
});

server.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
});
