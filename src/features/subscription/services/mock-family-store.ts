import type { FamilySeatUsage } from '../domain/entitlement';
import type { FamilyMemberView, InvitationView } from '../components/family-membership';

/**
 * A deterministic in-memory family, for building and screenshotting the family screens.
 *
 * ── Why this is not a database ──────────────────────────────────────────────
 * The real model is documented in `docs/PHASE_5_SUBSCRIPTION_FAMILY_DATA_MODEL.md` and is not
 * applied this phase. This store exists so the five family screens have real behaviour — a seat
 * that fills, an invitation that expires, a removal that frees a seat — without pretending a
 * backend exists.
 *
 * It nevertheless enforces the same invariants the SQL will, because those invariants are the
 * thing worth testing now: **the organizer occupies seat one of six**, the seventh member is
 * refused, and the organizer cannot be removed.
 */

export const FAMILY_SEAT_LIMIT = 6;

export type AddMemberOutcome = 'added' | 'family_full' | 'already_member';
export type InviteOutcome = 'invited' | 'family_full' | 'already_invited';

export type FamilyState = {
  readonly name: string;
  readonly members: readonly FamilyMemberView[];
  readonly invitations: readonly InvitationView[];
};

const ORGANIZER: FamilyMemberView = {
  id: 'organizer',
  name: 'Ahmed Al-Rashid',
  role: 'organizer',
  isSelf: true,
};

function initialState(): FamilyState {
  // Seat one is the organizer, from the moment the family exists. There is no state in which a
  // family has members but no organizer.
  return { name: '', members: [ORGANIZER], invitations: [] };
}

let state: FamilyState = initialState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export const mockFamilyStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  getState(): FamilyState {
    return state;
  },

  /** Seat usage. `used` counts the organizer, so it is never lower than 1. */
  getSeatUsage(): FamilySeatUsage {
    return {
      used: state.members.length,
      limit: FAMILY_SEAT_LIMIT,
      pendingInvitations: state.invitations.filter((i) => i.status === 'pending').length,
    };
  },

  isFull(): boolean {
    return state.members.length >= FAMILY_SEAT_LIMIT;
  },

  create(name: string): void {
    state = { ...initialState(), name: name.trim() };
    emit();
  },

  /**
   * Adds a member.
   *
   * Refuses at the limit rather than replacing anyone — the brief forbids silently removing or
   * replacing a member to make room.
   */
  addMember(name: string): AddMemberOutcome {
    if (state.members.some((m) => m.name.toLowerCase() === name.trim().toLowerCase())) {
      return 'already_member';
    }
    if (mockFamilyStore.isFull()) {
      return 'family_full';
    }
    state = {
      ...state,
      members: [
        ...state.members,
        {
          id: `member-${state.members.length + 1}`,
          name: name.trim(),
          role: 'adult',
          isSelf: false,
        },
      ],
    };
    emit();
    return 'added';
  },

  /** Removing the organizer is refused; transferring the role is deferred. */
  removeMember(id: string): 'removed' | 'organizer_cannot_leave' | 'not_found' {
    const member = state.members.find((m) => m.id === id);
    if (member === undefined) {
      return 'not_found';
    }
    if (member.role === 'organizer') {
      return 'organizer_cannot_leave';
    }
    state = { ...state, members: state.members.filter((m) => m.id !== id) };
    emit();
    return 'removed';
  },

  invite(email: string, expiresLabel: string): InviteOutcome {
    const normalized = email.trim().toLowerCase();
    if (
      state.invitations.some((i) => i.email.toLowerCase() === normalized && i.status === 'pending')
    ) {
      return 'already_invited';
    }
    // An invitation holds no seat until accepted, but there is no point sending one into a full
    // family — the acceptance would be refused.
    if (mockFamilyStore.isFull()) {
      return 'family_full';
    }
    state = {
      ...state,
      invitations: [
        ...state.invitations,
        {
          id: `invite-${state.invitations.length + 1}`,
          email: email.trim(),
          status: 'pending',
          expiresLabel,
        },
      ],
    };
    emit();
    return 'invited';
  },

  revokeInvitation(id: string): void {
    state = {
      ...state,
      invitations: state.invitations.map((i) =>
        i.id === id ? { ...i, status: 'revoked' as const } : i,
      ),
    };
    emit();
  },

  /** Accepting consumes a seat, which is where the six-seat ceiling actually bites. */
  acceptInvitation(id: string): AddMemberOutcome {
    const invitation = state.invitations.find((i) => i.id === id);
    if (invitation === undefined) {
      return 'already_member';
    }
    // The local part of the address stands in for a display name until the invitee has a profile.
    const displayName = invitation.email.split('@')[0] ?? invitation.email;
    const outcome = mockFamilyStore.addMember(displayName);
    if (outcome !== 'added') {
      // Left pending, not consumed: the organizer can free a seat and the same link still works.
      return outcome;
    }
    state = {
      ...state,
      invitations: state.invitations.map((i) =>
        i.id === id ? { ...i, status: 'accepted' as const } : i,
      ),
    };
    emit();
    return 'added';
  },

  /** Test and screenshot seam. */
  reset(next?: Partial<FamilyState>): void {
    state = { ...initialState(), ...next };
    emit();
  },
};
