import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { storageContract } from '../support/storage-contract.js';

const dir = mkdtempSync(join(tmpdir(), 'guild-bot-'));
const open: SqliteStorage[] = [];
let n = 0;
const fresh = (file = join(dir, `db-${n++}.sqlite`)) => {
  const s = new SqliteStorage(file);
  open.push(s);
  return s;
};

afterAll(() => {
  for (const s of open) s.close();
  rmSync(dir, { recursive: true, force: true });
});

storageContract('sqlite', () => Promise.resolve(fresh()));

describe('SqliteStorage migrations', () => {
  it('applies migrations once and keeps data when the file is opened twice', async () => {
    const file = join(dir, 'reopen.sqlite');
    const first = new SqliteStorage(file);
    await first.saveMember({ userId: 'u1', battleNetId: 5 });
    first.close();

    const second = fresh(file);
    expect(await second.getMember('u1')).toEqual({ userId: 'u1', battleNetId: 5 });
    second.close();

    const db = new Database(file);
    const rows = db.prepare('SELECT version FROM schema_migrations').all();
    db.close();
    expect(rows).toEqual([{ version: 1 }]);
  });
});
