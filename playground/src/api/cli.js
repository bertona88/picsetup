import { createReadStream } from 'node:fs';
import process from 'node:process';
import { executeCommand } from './commands';

// Accommodate a full six-document notebook plus its command envelope.
// Individual recipe/document limits remain independently enforced.
const MAX_BYTES = 7 * 1_048_576;
async function readInput(path) {
  const stream = path && path !== '-' ? createReadStream(path) : process.stdin;
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stream) {
    bytes += chunk.length;
    if (bytes > MAX_BYTES) {
      stream.destroy();
      throw new Error('Command JSON exceeds the 7 MiB limit.');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

try {
  if (process.argv.length > 3) throw new Error('Usage: node dist-api/cli.mjs [command.json|-]. Omit the path to read stdin.');
  const text = await readInput(process.argv[2]);
  let command;
  try { command = JSON.parse(text); } catch { throw new Error('Expected a single JSON command on stdin or in the specified file.'); }
  const result = await executeCommand(command);
  process.stdout.write(`${JSON.stringify({ ok: true, result }, (_, value) => typeof value === 'number' && !Number.isFinite(value) ? null : value, 2)}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Command failed.' })}\n`);
  process.exitCode = 1;
}
