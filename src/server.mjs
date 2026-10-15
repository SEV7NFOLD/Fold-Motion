import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createStaticServer } from './runtime/static-server.mjs';

export async function startServer({
  root = path.join(process.cwd(), 'public'),
  host = process.env.HOST ?? '0.0.0.0',
  port = Number.parseInt(process.env.PORT ?? '4173', 10),
} = {}) {
  const server = await createStaticServer({ root, host, port });
  const displayHost = server.host === '0.0.0.0' ? 'localhost' : server.host;
  console.log(`SEV7N FOLD Motion Engine running at http://${displayHost}:${server.port}`);

  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await startServer();
}
