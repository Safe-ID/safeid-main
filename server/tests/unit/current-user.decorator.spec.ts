import { describe, expect, it } from '@jest/globals';
import { CurrentUser } from '../../src/api/decorators/current-user.decorator';

describe('CurrentUser decorator', () => {
  it('can be invoked through the Nest decorator API without throwing', () => {
    const currentUserDecorator = CurrentUser as any;
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: {
            id: 7,
            email: 'owner@example.com',
            role: 'admin',
          },
        }),
      }),
    } as any;

    expect(() => currentUserDecorator(undefined, ctx, 0)).not.toThrow();
    expect(() => currentUserDecorator('email', ctx, 0)).not.toThrow();
  });
});
