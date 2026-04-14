import { describe, expect, it } from 'vitest';
import { clientMessageSchema, serverMessageSchema } from '@shared/protocol';

describe('protocol schemas', () => {
  it('accepts input client messages', () => {
    const result = clientMessageSchema.safeParse({
      type: 'input',
      payload: { buttons: [0, 1], axes: [0.5, -0.5] },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid client messages', () => {
    const result = clientMessageSchema.safeParse({
      type: 'input',
      payload: { buttons: ['bad'], axes: [] },
    });
    expect(result.success).toBe(false);
  });

  it('accepts clear chat client messages', () => {
    const result = clientMessageSchema.safeParse({
      type: 'coop_chat_clear',
      sessionId: 'session-1',
      userId: 'user-1',
    });
    expect(result.success).toBe(true);
  });

  it('accepts server cpp messages', () => {
    const result = serverMessageSchema.safeParse({
      type: 'cpp',
      text: 'ok',
    });
    expect(result.success).toBe(true);
  });

  it('accepts server error messages', () => {
    const result = serverMessageSchema.safeParse({
      type: 'error',
      message: 'oops',
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown server messages', () => {
    const result = serverMessageSchema.safeParse({
      type: 'unknown',
      text: 'nope',
    });
    expect(result.success).toBe(false);
  });
});
