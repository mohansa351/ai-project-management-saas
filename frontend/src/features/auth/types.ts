export type PublicUser = {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  emailVerifiedAt: string | null;
  systemRole: 'USER' | 'SUPER_ADMIN';
  createdAt: string;
  updatedAt: string;
};

export type SessionStatus =
  | 'unknown'
  | 'restoring'
  | 'authenticated'
  | 'unauthenticated'
  | 'logging-out';

export type AccessTokenUserPayload = {
  accessToken: string;
  user: PublicUser;
};
