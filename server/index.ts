import 'dotenv/config';
import { createServer } from 'node:http';
import { createApp } from './app';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be a valid TCP port');
}

createServer(createApp()).listen(port, host, () => {
  console.log(`NineGrid API listening on http://${host}:${port}`);
});
