import { describe, expect, it } from 'vitest';
import { initialState } from '../config/initialState';
import { baseConfig } from '../config/baseConfig';
import { buildHelpCenterData, getHelpTopic } from './help';

describe('shared player help', () => {
  it('exposes the same discoverable dynamic topics and category order used by React', () => {
    const data = buildHelpCenterData(initialState, baseConfig);
    const ids = data.topics.map((topic) => topic.id);

    expect(data.categories.map((category) => category.label)).toContain('Risk and regulation');
    expect(ids).toContain('capital-buffer-framework');
    expect(ids).toContain('pillar-2a-srep');
    expect(ids).toContain('uk-leverage-framework');
    expect(getHelpTopic(data, 'capital-buffer-framework')?.title).toBe('Capital conservation, CCyB and O-SII buffers');
    expect(data.introduction).toContain('one month at a time');
  });
});
