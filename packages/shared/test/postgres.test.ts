import { describe, expect, it } from 'vitest';
import { semSslmode, sslDoPostgres } from '../src/postgres.js';

describe('sslDoPostgres', () => {
  it('sem TLS em localhost', () => {
    expect(sslDoPostgres('postgres://postgres@localhost:5432/x')).toBeUndefined();
    expect(sslDoPostgres('postgres://u:p@127.0.0.1/x')).toBeUndefined();
  });

  it('sem TLS na rede privada do Railway', () => {
    expect(sslDoPostgres('postgresql://postgres:s@postgres.railway.internal:5432/railway')).toBeUndefined();
  });

  it('respeita sslmode=disable e no-verify', () => {
    expect(sslDoPostgres('postgres://u:p@db.exemplo.com/x?sslmode=disable')).toBeUndefined();
    expect(sslDoPostgres('postgres://u:p@shuttle.proxy.rlwy.net:41234/railway?sslmode=no-verify')).toEqual({
      rejectUnauthorized: false,
    });
  });

  it('verifica o certificado nos demais', () => {
    expect(sslDoPostgres('postgres://u:p@ep-x.sa-east-1.aws.neon.tech/db?sslmode=require')).toEqual({
      rejectUnauthorized: true,
    });
  });
});

describe('semSslmode', () => {
  it('remove os parâmetros de TLS e mantém o resto', () => {
    expect(semSslmode('postgres://u:p@h:5432/db?sslmode=require&application_name=a')).toBe(
      'postgres://u:p@h:5432/db?application_name=a',
    );
  });
});
