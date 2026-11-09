import type { BankState } from '../domain/bankState';
import type { SimulationConfig } from '../domain/config';
import { buildMechanicsDynamicContext } from '../content/mechanicsContext';
import { buildMechanicsRegistry, type MechanicCategory, type MechanicEntry } from '../content/mechanicsRegistry';
import { pillar2AHelpEntry } from '../content/pillar2AHelp';
import { capitalBuffersHelpEntry } from '../content/capitalBuffersHelp';
import { leverageHelpEntry } from '../content/leverageHelp';

export const HELP_CATEGORY_ORDER: readonly MechanicCategory[] = [
  'Start Here', 'Customers', 'Lending', 'Treasury', 'Capital', 'Risk Measures', 'Market & Reports',
];

export const HELP_CATEGORY_LABEL: Readonly<Record<MechanicCategory, string>> = {
  'Start Here': 'Playing the game',
  Customers: 'Customers',
  Lending: 'Lending',
  Treasury: 'Treasury',
  Capital: 'Capital',
  'Risk Measures': 'Risk and regulation',
  'Market & Reports': 'Market and reports',
};

export interface HelpCenterData {
  introduction: string;
  categories: Array<{
    id: string;
    category: MechanicCategory;
    label: string;
    entries: MechanicEntry[];
  }>;
  topics: MechanicEntry[];
}

/**
 * Build the complete player help surface from the same mechanics registry the React Help Center
 * renders. API help endpoints should select a topic from this result rather than duplicating text.
 */
export const buildHelpCenterData = (state: BankState, config: SimulationConfig): HelpCenterData => {
  const context = buildMechanicsDynamicContext({ state, config });
  const topics = [...buildMechanicsRegistry(context), capitalBuffersHelpEntry, pillar2AHelpEntry, leverageHelpEntry];
  const categories = HELP_CATEGORY_ORDER.map((category) => ({
    id: category.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    category,
    label: HELP_CATEGORY_LABEL[category],
    entries: topics.filter((entry) => entry.category === category),
  })).filter((category) => category.entries.length > 0);
  return {
    introduction: 'BankSim advances one month at a time. Your decisions change customer behaviour, lending, funding, profit, and risk.',
    categories,
    topics,
  };
};

export const getHelpTopic = (data: HelpCenterData, topicId: string): MechanicEntry | undefined =>
  data.topics.find((topic) => topic.id === topicId);
