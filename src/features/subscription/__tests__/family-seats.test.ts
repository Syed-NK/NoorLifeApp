import { PLAN_CAPABILITIES, isFamilyFull, remainingSeats } from '../domain/entitlement';
import { FAMILY_SEAT_LIMIT, mockFamilyStore } from '../services/mock-family-store';

/**
 * The six-seat ceiling.
 *
 * "Family means six accounts total, not six additional accounts" is the rule most easily got
 * wrong, so it is asserted from several directions: the capability table, the store's counting,
 * and the refusal of a seventh.
 */

beforeEach(() => {
  mockFamilyStore.reset();
});

describe('the seat limit', () => {
  it('is six, everywhere', () => {
    expect(FAMILY_SEAT_LIMIT).toBe(6);
    expect(PLAN_CAPABILITIES.premium_family.memberLimit).toBe(6);
  });

  it('counts the organizer as one of the six', () => {
    // A brand-new family already uses a seat, because the organizer is in it.
    const usage = mockFamilyStore.getSeatUsage();
    expect(usage.used).toBe(1);
    expect(usage.limit).toBe(6);
    expect(remainingSeats(usage)).toBe(5);
  });

  it('fills at five additional members, not six', () => {
    for (const name of ['Fatima', 'Yusuf', 'Maryam', 'Omar', 'Aisha']) {
      expect(mockFamilyStore.addMember(name)).toBe('added');
    }

    const usage = mockFamilyStore.getSeatUsage();
    expect(usage.used).toBe(6);
    expect(isFamilyFull(usage)).toBe(true);
    expect(remainingSeats(usage)).toBe(0);
    expect(mockFamilyStore.isFull()).toBe(true);
  });

  it('refuses a seventh account', () => {
    for (const name of ['Fatima', 'Yusuf', 'Maryam', 'Omar', 'Aisha']) {
      mockFamilyStore.addMember(name);
    }

    expect(mockFamilyStore.addMember('Zaid')).toBe('family_full');
    // Nothing was displaced to make room — the brief forbids silent removal or replacement.
    expect(mockFamilyStore.getSeatUsage().used).toBe(6);
    expect(mockFamilyStore.getState().members).toHaveLength(6);
    expect(mockFamilyStore.getState().members[0]?.role).toBe('organizer');
  });

  it('frees a seat when a member is removed', () => {
    mockFamilyStore.addMember('Fatima');
    expect(mockFamilyStore.getSeatUsage().used).toBe(2);

    const member = mockFamilyStore.getState().members[1];
    expect(mockFamilyStore.removeMember(member?.id ?? '')).toBe('removed');
    expect(mockFamilyStore.getSeatUsage().used).toBe(1);
    // The seat is genuinely reusable afterwards.
    expect(mockFamilyStore.addMember('Yusuf')).toBe('added');
  });
});

describe('the organizer', () => {
  it('cannot be removed', () => {
    // Transferring the role is deferred, so leaving must be refused rather than half-supported.
    expect(mockFamilyStore.removeMember('organizer')).toBe('organizer_cannot_leave');
    expect(mockFamilyStore.getState().members).toHaveLength(1);
  });

  it('is always present, so a family can never exist without one', () => {
    mockFamilyStore.addMember('Fatima');
    const organizers = mockFamilyStore.getState().members.filter((m) => m.role === 'organizer');
    expect(organizers).toHaveLength(1);
  });
});

describe('invitations', () => {
  it('hold no seat until accepted', () => {
    mockFamilyStore.invite('fatima@example.com', 'Expires in 7 days');

    const usage = mockFamilyStore.getSeatUsage();
    expect(usage.used).toBe(1);
    expect(usage.pendingInvitations).toBe(1);
  });

  it('consume a seat on acceptance', () => {
    mockFamilyStore.invite('fatima@example.com', 'Expires in 7 days');
    const invitation = mockFamilyStore.getState().invitations[0];

    expect(mockFamilyStore.acceptInvitation(invitation?.id ?? '')).toBe('added');
    expect(mockFamilyStore.getSeatUsage().used).toBe(2);
    expect(mockFamilyStore.getState().invitations[0]?.status).toBe('accepted');
  });

  it('cannot be accepted twice', () => {
    mockFamilyStore.invite('fatima@example.com', 'Expires in 7 days');
    const id = mockFamilyStore.getState().invitations[0]?.id ?? '';

    expect(mockFamilyStore.acceptInvitation(id)).toBe('added');
    // The second attempt does not add a duplicate member or consume another seat.
    expect(mockFamilyStore.acceptInvitation(id)).toBe('already_member');
    expect(mockFamilyStore.getSeatUsage().used).toBe(2);
  });

  it('are not duplicated for the same address', () => {
    expect(mockFamilyStore.invite('fatima@example.com', 'x')).toBe('invited');
    expect(mockFamilyStore.invite('fatima@example.com', 'x')).toBe('already_invited');
    expect(mockFamilyStore.getState().invitations).toHaveLength(1);
  });

  it('are refused once the family is full', () => {
    for (const name of ['Fatima', 'Yusuf', 'Maryam', 'Omar', 'Aisha']) {
      mockFamilyStore.addMember(name);
    }
    expect(mockFamilyStore.invite('zaid@example.com', 'x')).toBe('family_full');
  });

  it('can be revoked, which leaves the seat count untouched', () => {
    mockFamilyStore.invite('fatima@example.com', 'x');
    const id = mockFamilyStore.getState().invitations[0]?.id ?? '';

    mockFamilyStore.revokeInvitation(id);
    expect(mockFamilyStore.getState().invitations[0]?.status).toBe('revoked');
    expect(mockFamilyStore.getSeatUsage().pendingInvitations).toBe(0);
    expect(mockFamilyStore.getSeatUsage().used).toBe(1);
  });

  it('stay pending when accepted into a family that filled up meanwhile', () => {
    mockFamilyStore.invite('zaid@example.com', 'x');
    const id = mockFamilyStore.getState().invitations[0]?.id ?? '';

    // The family fills after the invitation went out.
    for (const name of ['Fatima', 'Yusuf', 'Maryam', 'Omar', 'Aisha']) {
      mockFamilyStore.addMember(name);
    }

    expect(mockFamilyStore.acceptInvitation(id)).toBe('family_full');
    // Not consumed: the organizer can free a seat and the same link still works.
    expect(mockFamilyStore.getState().invitations[0]?.status).toBe('pending');
    expect(mockFamilyStore.getSeatUsage().used).toBe(6);
  });
});
