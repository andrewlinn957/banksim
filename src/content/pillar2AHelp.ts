import { MechanicEntry } from './mechanicsRegistry';

export const pillar2AHelpEntry: MechanicEntry = {
  id: 'pillar-2a-srep',
  category: 'Capital',
  title: 'Pillar 2A and the annual SREP',
  plainDescription:
    'Pillar 2A is a firm-specific minimum capital requirement for risks that Pillar 1 does not capture, or does not capture adequately. BankSim reassesses variable Pillar 2A once every 12 months from the bank’s balance sheet and risk profile.',
  whyItMatters:
    'The percentage set at the SREP stays in force until the next annual review, so decisions can have a delayed capital consequence. The £ requirement still moves with current RWA during the year.',
  driverSummary: [
    'Credit risk compares the standardised Pillar 1 treatment with the PRA Table A2 benchmark excluding expected losses; portfolio over-capitalisation can offset benchmark shortfalls elsewhere.',
    'Credit concentration separately measures single-name, sector and international geographic HHI using RWA shares. BankSim applies the midpoint of the PRA’s published add-on range for the applicable HHI bucket.',
    'The small-bank IRRBB assessment uses the greater of the board’s EVE policy limit and the modelled loss under a ±200bp rate move. BankSim applies a disclosed 20% capitalisation scalar because the PRA does not publish a simple mechanical conversion for this standard approach.',
    'PS15/20 then reduces variable P2A for the structural UK CCyB uplift using the bank’s UK credit pass-through. The sandbox assumes the bank is low-risk and MREL equals TCR, so the possible additional reduction is applied subject to its 1% floor.',
    'Changing concentration, duration or the IRRBB policy limit does not immediately rewrite P2A. The new risk profile is picked up at the next annual SREP.',
  ],
  formula:
    'Gross P2A = credit-risk add-on + single-name + sector + geography + IRRBB\nAssessed P2A rate = gross P2A / assessment RWA - PS15/20 offsets\nCurrent P2A amount = assessed P2A rate × current RWA',
  relatedMetrics: ['Pillar 2A rate', 'RWA', 'Sector concentration', 'EVE +100bp'],
  relatedActions: ['Maximum LTV', 'Initial fixed period', 'Gilt portfolio duration', 'Swap notional', 'IRRBB EVE limit'],
};
