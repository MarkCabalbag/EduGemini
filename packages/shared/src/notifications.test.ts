import { describe, expect, it } from 'vitest';
import { ListNotificationsQuerySchema, NotificationParamsSchema, RelativeLinkSchema } from './notifications';

describe('ListNotificationsQuerySchema', () => {
  it('lists everything, 25 to a page, unless told otherwise', () => {
    expect(ListNotificationsQuerySchema.parse({})).toEqual({ unreadOnly: false, limit: 25 });
    expect(ListNotificationsQuerySchema.parse({ unreadOnly: 'true', limit: '100' })).toEqual({ unreadOnly: true, limit: 100 });
    expect(ListNotificationsQuerySchema.parse({ unreadOnly: 'false' }).unreadOnly).toBe(false);
  });

  it.each([{ unreadOnly: 'yes' }, { unreadOnly: '1' }, { unreadOnly: 'TRUE' }, { limit: '0' }, { limit: '101' }, { cursor: '' }])(
    'rejects %j',
    (query) => {
      expect(ListNotificationsQuerySchema.safeParse(query).success).toBe(false);
    },
  );
});

describe('NotificationParamsSchema', () => {
  it('needs a UUID', () => {
    expect(NotificationParamsSchema.safeParse({ notificationId: 'not-a-uuid' }).success).toBe(false);
    expect(NotificationParamsSchema.safeParse({ notificationId: '00000000-0000-4000-8000-000000000001' }).success).toBe(true);
  });
});

describe('RelativeLinkSchema', () => {
  it.each(['/notifications', '/assignments/1', '/settings/ai'])('accepts %s', (link) => {
    expect(RelativeLinkSchema.safeParse(link).success).toBe(true);
  });

  it.each(['//evil.example', 'https://evil.example', 'assignments/1', ''])('rejects %j', (link) => {
    expect(RelativeLinkSchema.safeParse(link).success).toBe(false);
  });
});
