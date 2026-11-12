import fs from 'node:fs';
import type { Replay } from './types.js';

/** Throws a readable error if `x` is not a usable replay. */
export function validateReplay(x: unknown): Replay {
  const r = x as Replay;
  if (!r || typeof r !== 'object') throw new Error('Replay must be a JSON object');
  if (r.format !== 'agentcorp-replay') throw new Error('Not an AgentCorp replay (missing format: "agentcorp-replay")');
  if (r.version !== 1) throw new Error(`Unsupported replay version ${String(r.version)}`);
  if (!Array.isArray(r.frames) || !r.frames.length) throw new Error('Replay has no frames');
  if (!Array.isArray(r.events)) throw new Error('Replay has no events array');
  if (!Array.isArray(r.companies) || !r.companies.length) throw new Error('Replay has no companies');
  return r;
}

export function readReplay(file: string): Replay {
  return validateReplay(JSON.parse(fs.readFileSync(file, 'utf8')));
}

export function writeReplay(file: string, replay: Replay): void {
  fs.writeFileSync(file, JSON.stringify(replay));
}
