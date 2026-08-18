import { create } from 'zustand';

import type { PublicUser, SessionStatus } from '@/features/auth/types';

export type SessionState = {
  authGeneration: number;
  status: SessionStatus;
  accessToken: string | null;
  user: PublicUser | null;
  currentOrganizationId: string | null;
  setRestoring: () => void;
  applySession: (accessToken: string, user: PublicUser) => void;
  setCurrentOrganizationId: (organizationId: string | null) => void;
  clearToUnauthenticated: () => void;
  beginLogout: () => number;
  resetForTests: () => void;
};

export const useSessionStore = create<SessionState>((set, get) => ({
  authGeneration: 0,
  status: 'unknown',
  accessToken: null,
  user: null,
  currentOrganizationId: null,
  setRestoring: () => {
    if (get().status === 'authenticated' || get().status === 'logging-out') {
      return;
    }
    set({ status: 'restoring' });
  },
  applySession: (accessToken, user) => {
    const previousUserId = get().user?.id;
    set({
      status: 'authenticated',
      accessToken,
      user,
      currentOrganizationId: previousUserId === user.id ? get().currentOrganizationId : null,
    });
  },
  setCurrentOrganizationId: (organizationId) => {
    const trimmed = organizationId?.trim() ?? '';
    set({ currentOrganizationId: trimmed || null });
  },
  clearToUnauthenticated: () => {
    set({
      status: 'unauthenticated',
      accessToken: null,
      user: null,
      currentOrganizationId: null,
    });
  },
  beginLogout: () => {
    const next = get().authGeneration + 1;
    set({
      authGeneration: next,
      status: 'logging-out',
      accessToken: null,
      user: null,
      currentOrganizationId: null,
    });
    return next;
  },
  resetForTests: () => {
    set({
      authGeneration: 0,
      status: 'unknown',
      accessToken: null,
      user: null,
      currentOrganizationId: null,
    });
  },
}));
