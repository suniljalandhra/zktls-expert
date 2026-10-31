import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CheckError } from './errors.js';

// Durable record of what we've already attested: one attestation per GitHub username, and each proof once.
// A JSON file is enough for a single-process demo; a real deployment would use a DB with unique constraints.

export type Attested = { wallet: string; uid: string; txHash: string; proofId: string; at: number };

type Data = { bySubject: Record<string, Attested>; usedProofs: Record<string, true> };

export class Store {
  private data: Data;
  // Reservations are in memory only: they close the race between "checked" and "attested".
  private reserved = new Set<string>();

  constructor(private path: string | null) {
    this.data = { bySubject: {}, usedProofs: {} };
    if (path) {
      try {
        this.data = JSON.parse(readFileSync(path, 'utf8')) as Data;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
  }

  // Synchronous on purpose: no await between check and reserve, so two requests can't both pass.
  reserve(subjectHash: string, proofId: string): void {
    if (this.data.bySubject[subjectHash] || this.reserved.has(subjectHash)) {
      throw new CheckError('this GitHub account already has an attestation');
    }
    if (this.data.usedProofs[proofId]) throw new CheckError('this proof was already used');
    this.reserved.add(subjectHash);
  }

  release(subjectHash: string): void {
    this.reserved.delete(subjectHash);
  }

  commit(subjectHash: string, record: Attested): void {
    this.data.bySubject[subjectHash] = record;
    this.data.usedProofs[record.proofId] = true;
    this.reserved.delete(subjectHash);
    this.flush();
  }

  get(subjectHash: string): Attested | undefined {
    return this.data.bySubject[subjectHash];
  }

  private flush(): void {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.path); // atomic replace, so a crash mid-write can't corrupt the store
  }
}
