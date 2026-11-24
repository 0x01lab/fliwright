import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { closeSync, constants, fstatSync, linkSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CloudError, secureFileMaxBytes, secureFileMaxCount, secureFilePathSchema, type ProjectSecureFile } from '@fliwright/cloud-protocol';
import { digest, identifier, type CloudStore } from './CloudStore.js';

/** Ciphertext lives in SQLite. The key is kept in the private Cloud data directory. */
export class ProjectSecureFiles {
  constructor(private readonly store: CloudStore, private readonly keyPath: string) {}

  private key(create: boolean): Buffer {
    const read = () => {
      const fd = openSync(this.keyPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size !== 32 || (stat.mode & 0o077) !== 0) throw new Error('Invalid project secure file key');
        const bytes = readFileSync(fd);
        if (bytes.length !== 32) throw new Error('Invalid project secure file key');
        return bytes;
      } finally { closeSync(fd); }
    };
    try { return read(); }
    catch (error) {
      if (!create || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (this.store.db.prepare('SELECT 1 FROM project_secure_files LIMIT 1').get())
      throw new Error('Restore the project secure file key before uploading');
    const directory = mkdtempSync(join(dirname(this.keyPath), '.secure-file-key-'));
    try {
      const staged = join(directory, 'key');
      writeFileSync(staged, randomBytes(32), { flag: 'wx', mode: 0o600 });
      try { linkSync(staged, this.keyPath); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      return read();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }

  list(projectId: string): ProjectSecureFile[] {
    this.store.project(projectId);
    return this.store.db.prepare('SELECT id,path,size,created_at FROM project_secure_files WHERE project_id=? ORDER BY path').all(projectId)
      .map(row => ({ id: String(row.id), path: String(row.path), size: Number(row.size), createdAt: Number(row.created_at) }));
  }

  upload(projectId: string, path: string, value: Buffer, actor: string): ProjectSecureFile {
    secureFilePathSchema.parse(path);
    if (!value.length || value.length > secureFileMaxBytes) throw new CloudError(400, 'Secure file must contain between 1 byte and 1 MiB');
    return this.store.transaction(() => {
      const files = this.list(projectId);
      if (files.some(file => file.path === path)) throw new CloudError(409, 'This path already has a secure file');
      if (files.length >= secureFileMaxCount) throw new CloudError(409, 'Project secure file limit reached');
      const id = identifier(), createdAt = this.store.now(), iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', this.key(true), iv).setAAD(Buffer.from(JSON.stringify([projectId, id, path])));
      const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
      this.store.db.prepare('INSERT INTO project_secure_files(id,project_id,path,size,created_at,iv,tag,ciphertext) VALUES(?,?,?,?,?,?,?,?)')
        .run(id, projectId, path, value.length, createdAt, iv, cipher.getAuthTag(), ciphertext);
      this.store.event(null, 'project-secure-file-uploaded', { actor, projectId, fileId: id });
      return { id, path, size: value.length, createdAt };
    });
  }

  remove(projectId: string, id: string, actor: string): void {
    this.store.transaction(() => {
      this.store.project(projectId);
      const referenced = this.store.db.prepare(`SELECT 1 FROM requests, json_each(requests.data,'$.secureFiles') AS file
        WHERE state IN ('queued','assigned','preparing','running','finalizing','cancel_requested') AND json_extract(file.value,'$.id')=? LIMIT 1`).get(id);
      if (referenced) throw new CloudError(409, 'This secure file is in use by a pending test request');
      if (!this.store.db.prepare('DELETE FROM project_secure_files WHERE project_id=? AND id=?').run(projectId, id).changes)
        throw new CloudError(404, 'Project secure file not found');
      this.store.event(null, 'project-secure-file-removed', { actor, projectId, fileId: id });
    });
  }

  read(projectId: string, id: string, path: string) {
    const row = this.store.db.prepare('SELECT iv,tag,ciphertext FROM project_secure_files WHERE project_id=? AND id=? AND path=?').get(projectId, id, path);
    if (!row) throw new CloudError(404, 'Project secure file not found');
    const decipher = createDecipheriv('aes-256-gcm', this.key(false), row.iv as Uint8Array)
      .setAAD(Buffer.from(JSON.stringify([projectId, id, path]))).setAuthTag(row.tag as Uint8Array);
    const value = Buffer.concat([decipher.update(row.ciphertext as Uint8Array), decipher.final()]);
    return { content: value.toString('base64'), sha256: digest(value) };
  }
}
