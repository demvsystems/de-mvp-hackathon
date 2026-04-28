import { describe, expect, it } from 'vitest';
import { mentionExtractorModule } from './index';

describe('mentionExtractorModule', () => {
  it('exposes a JetStream consumer config', () => {
    expect(mentionExtractorModule.consumer).toBeDefined();
    expect(mentionExtractorModule.consumer.durable_name).toBe('mention-extractor');
  });

  it('subscribes to record events with a stable filter subject', () => {
    // Mention-Extractor scant nur Records, keine Edges/Topics — der Filter
    // hält den Worker-Konsum eng und vermeidet überflüssige acks.
    expect(mentionExtractorModule.consumer.filter_subject).toBe('events.record.>');
  });

  it('exposes a register function for a subscriber', () => {
    expect(typeof mentionExtractorModule.register).toBe('function');
  });
});
