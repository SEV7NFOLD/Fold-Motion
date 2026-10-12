import path from 'node:path';
import { createStaticServer } from '../src/runtime/static-server.mjs';

const port = Number.parseInt(process.env.PORT ?? '4173', 10);
const server = await createStaticServer({
  root: path.join(process.cwd(), 'public'),
  port,
});

console.log(`FOLD Motion preview: http://${server.host}:${server.port}`);

const stop = async () => {
  await server.close();
  process.exit(0);
};

process.once('SIGINT', stop);
process.once('SIGTERM', stop);
