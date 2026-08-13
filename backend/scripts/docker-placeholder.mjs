import http from 'node:http';
import process from 'node:process';

const parsed = Number(process.env.PORT);
const port =
  Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : 4000;

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('backend placeholder\n');
});

server.on('error', (err) => {
  process.stderr.write(`backend placeholder listen error: ${err}\n`);
  process.exit(1);
});

const shutdown = () => {
  server.close(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`backend placeholder listening on ${port}\n`);
});
