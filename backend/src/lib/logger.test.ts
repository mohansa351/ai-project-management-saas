import { Writable } from 'node:stream';
import { describe, expect, it } from '@jest/globals';
import { createLogger } from './logger.js';

class MemoryDestination extends Writable {
  chunks: string[] = [];

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(chunk.toString());
    callback();
  }

  output(): string {
    return this.chunks.join('');
  }
}

describe('logger redaction', () => {
  it('redacts JWT and session secrets from log output', () => {
    const destination = new MemoryDestination();
    const log = createLogger({ level: 'info', destination });
    log.info(
      {
        accessToken: 'jwt-should-not-leak',
        refreshToken: 'opaque-refresh-should-not-leak',
        refresh_token: 'cookie-refresh-should-not-leak',
        authorization: 'Bearer jwt-should-not-leak',
        JWT_ACCESS_SECRET: 'env-secret-should-not-leak',
        cookie: 'refresh_token=cookie-refresh-should-not-leak',
      },
      'session debug',
    );

    const output = destination.output();
    expect(output).toContain('session debug');
    expect(output).not.toContain('jwt-should-not-leak');
    expect(output).not.toContain('opaque-refresh-should-not-leak');
    expect(output).not.toContain('cookie-refresh-should-not-leak');
    expect(output).not.toContain('env-secret-should-not-leak');
    expect(output).toMatch(/\[Redacted\]/i);
  });
});
