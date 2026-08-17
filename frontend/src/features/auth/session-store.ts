import { create } from 'zustand';

import type { PublicUser, SessionStatus } from '@/features/auth/types';

export type SessionState = {
  authGeneration: number;
  status: SessionStatus;
  accessToken: string | null;
  user: PublicUser | null;
  setRestoring: () => void;
  applySession: (accessToken: string, user: PublicUser) => void;
  clearToUnauthenticated: () => void;
  beginLogout: () => number;
  resetForTests: () => void;
};

export const useSessionStore = create<SessionState>((set, get) => ({
  authGeneration: 0,
  status: 'unknown',
  accessToken: null,
  user: null,
  setRestoring: () => {
    if (get().status === 'authenticated' || get().status === 'logging-out') {
      return;
    }
    set({ status: 'restoring' });
  },
  applySession: (accessToken, user) => {
    set({
      status: 'authenticated',
      accessToken,
      user,
    });
  },
  clearToUnauthenticated: () => {
    set({
      status: 'unauthenticated',
      accessToken: null,
      user: null,
    });
  },
  beginLogout: () => {
    const next = get().authGeneration + 1;
    set({
      authGeneration: next,
      status: 'logging-out',
      accessToken: null,
      user: null,
    });
    return next;
  },
  resetForTests: () => {
    set({
      authGeneration: 0,
      status: 'unknown',
      accessToken: null,
      user: null,
    });
  },
}));
