import { jwtVerify, SignJWT } from 'jose';
import { env } from '../config/env.js';
import { AppError } from './http/appError.js';
import { AUTH_SESSION_UNAUTHORIZED_MESSAGE } from './http/authErrors.js';

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

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
    const sub = payload.sub;
    const email = payload.email;
    const systemRole = payload.systemRole;
    if (
      typeof sub !== 'string' ||
      sub.length === 0 ||
      typeof email !== 'string' ||
      (systemRole !== 'USER' && systemRole !== 'SUPER_ADMIN')
    ) {
      throw sessionUnauthorized();
    }
    return { sub, email, systemRole };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw sessionUnauthorized();
  }
}

function sessionUnauthorized(): AppError {
  return new AppError('AUTH_UNAUTHORIZED', AUTH_SESSION_UNAUTHORIZED_MESSAGE, 401);
}
