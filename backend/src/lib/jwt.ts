import { SignJWT } from 'jose';
import { env } from '../config/env.js';

export type AccessTokenClaims = {
  sub: string;
  email: string;
  systemRole: 'USER' | 'SUPER_ADMIN';
};

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env.JWT_ACCESS_SECRET);
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({
    email: claims.email,
    systemRole: claims.systemRole,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secretKey());
}
