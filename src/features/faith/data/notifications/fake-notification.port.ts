import type {
  ExactAlarmCapability,
  NotificationChannelSpec,
  NotificationPermission,
  NotificationPort,
  ScheduledAlert,
  ScheduleRequest,
} from './notification.port';

/**
 * An in-memory `NotificationPort`, for development fixtures and tests.
 *
 * ── Why this is a real implementation and not a set of `jest.fn()`s ─────────
 * Because the behaviour under test is *stateful*: schedule five, cancel two, list what remains,
 * reconcile, list again. Stubs that return fixed values cannot express that, and a test written
 * against them passes whether or not the service actually cancels anything.
 *
 * It also reaches the states a device will not produce on demand — permission denied, exact alarms
 * unavailable, and a platform that refuses the third `schedule` call of five. Those are the cases
 * prayer alerts have to survive, so they are the cases that need to be constructible.
 */

export type FakeNotificationPortOptions = {
  readonly permission?: NotificationPermission;
  /** What `requestPermission` will resolve to. Defaults to granting. */
  readonly grantOnRequest?: NotificationPermission;
  readonly exactAlarms?: ExactAlarmCapability;
  /**
   * Makes the Nth `schedule` call fail, 1-based. `null` for a platform that never refuses.
   *
   * The one setting that reaches partial-failure rollback, which is the branch with the most to go
   * wrong and the least chance of occurring on a developer's device.
   */
  readonly failScheduleOnCall?: number | null;
  /** Makes `ensureChannel` a no-op that records nothing, as a non-Android platform would. */
  readonly channelsSupported?: boolean;
};

export type FakeNotificationPort = NotificationPort & {
  /** Everything the fake believes is pending. */
  readonly pending: () => readonly ScheduledAlert[];
  /** Channels created, in creation order, so a test can assert the channel preceded the prompt. */
  readonly channels: () => readonly NotificationChannelSpec[];
  /** An ordered log of side-effecting calls, for asserting sequence rather than only outcome. */
  readonly calls: () => readonly string[];
  /** Drops everything pending without recording cancellations — simulates a reboot losing alarms. */
  readonly loseAllPending: () => void;
  readonly setPermission: (permission: NotificationPermission) => void;
  /** Immediately-presented notifications, so the test action can be asserted separately. */
  readonly presented: () => readonly { readonly title: string; readonly channelId: string }[];
};

export function createFakeNotificationPort(
  options: FakeNotificationPortOptions = {},
): FakeNotificationPort {
  let permission: NotificationPermission = options.permission ?? 'undetermined';
  const grantOnRequest = options.grantOnRequest ?? 'granted';
  const exactAlarms = options.exactAlarms ?? 'unknown';
  const channelsSupported = options.channelsSupported ?? true;
  const failOnCall = options.failScheduleOnCall ?? null;

  const scheduled = new Map<string, ScheduledAlert>();
  const channels: NotificationChannelSpec[] = [];
  const calls: string[] = [];
  const presented: { title: string; channelId: string }[] = [];
  let scheduleCalls = 0;
  let nextId = 1;

  return {
    async getPermission(): Promise<NotificationPermission> {
      return permission;
    },

    async requestPermission(): Promise<NotificationPermission> {
      calls.push('requestPermission');
      permission = grantOnRequest;
      return permission;
    },

    async ensureChannel(channel: NotificationChannelSpec): Promise<void> {
      if (!channelsSupported) {
        return;
      }
      calls.push(`ensureChannel:${channel.id}`);
      const existing = channels.findIndex((entry) => entry.id === channel.id);
      if (existing >= 0) {
        channels[existing] = channel;
      } else {
        channels.push(channel);
      }
    },

    async exactAlarmCapability(): Promise<ExactAlarmCapability> {
      return exactAlarms;
    },

    async schedule(request: ScheduleRequest): Promise<string | null> {
      scheduleCalls += 1;
      if (failOnCall !== null && scheduleCalls === failOnCall) {
        calls.push('schedule:refused');
        return null;
      }
      const identifier = `fake-${nextId}`;
      nextId += 1;
      calls.push(`schedule:${identifier}`);
      scheduled.set(identifier, {
        identifier,
        at: request.at.toISOString(),
        channelId: request.channelId,
        data: request.data,
      });
      return identifier;
    },

    async cancel(identifier: string): Promise<void> {
      calls.push(`cancel:${identifier}`);
      scheduled.delete(identifier);
    },

    async listScheduled(): Promise<readonly ScheduledAlert[]> {
      return [...scheduled.values()];
    },

    async presentNow(request: Omit<ScheduleRequest, 'at'>): Promise<string | null> {
      calls.push('presentNow');
      presented.push({ title: request.title, channelId: request.channelId });
      return `fake-presented-${presented.length}`;
    },

    async openSystemSettings(): Promise<void> {
      calls.push('openSystemSettings');
    },

    pending: () => [...scheduled.values()],
    channels: () => [...channels],
    calls: () => [...calls],
    loseAllPending: () => scheduled.clear(),
    setPermission: (next: NotificationPermission) => {
      permission = next;
    },
    presented: () => [...presented],
  };
}
