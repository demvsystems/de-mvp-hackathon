import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractSlackSnapshot } from './slack';

const PWX_BIPRO = join(process.cwd(), '../../apps/playground/Dummyfiles/pwx_ideen_bipro.json');

async function loadBipro(): Promise<unknown> {
  return JSON.parse(await readFile(PWX_BIPRO, 'utf8')) as unknown;
}

describe('extractSlackSnapshot', () => {
  it('liefert die slack-section als validiertes SlackSnapshot', async () => {
    const container = await loadBipro();
    const snapshot = extractSlackSnapshot(container);
    expect(snapshot.channel.id).toBe('C111BIPRO01');
    expect(snapshot.participants.length).toBeGreaterThan(0);
    expect(snapshot.content.length).toBeGreaterThan(0);
  });

  it('reicht Mention-Listen unverändert durch', async () => {
    const container = await loadBipro();
    const snapshot = extractSlackSnapshot(container);
    const firstMsg = snapshot.content[0]!;
    expect(Array.isArray(firstMsg.mentions)).toBe(true);
  });

  it('wirft, wenn der Container keine slack-section hat', () => {
    expect(() => extractSlackSnapshot({ cluster: 'foo' })).toThrow(/slack/i);
  });

  it('wirft, wenn die slack-section nicht zum Schema passt', () => {
    expect(() =>
      extractSlackSnapshot({
        cluster: 'foo',
        slack: { channel: { id: 'C1' } /* fehlt name, display_name, type */ },
      }),
    ).toThrow();
  });

  it('akzeptiert eine Inline-Fixture mit minimalem Snapshot', () => {
    const container = {
      cluster: 'inline_test',
      slack: {
        channel: { id: 'C9', name: 'test', display_name: '#test', type: 'public_channel' },
        participants: [],
        content: [],
      },
    };
    const snapshot = extractSlackSnapshot(container);
    expect(snapshot.channel.id).toBe('C9');
    expect(snapshot.content).toEqual([]);
  });
});
