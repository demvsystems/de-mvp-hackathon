import { adversarialResistance } from './adversarial-resistance';
import { artifactValidity } from './artifact-validity';
import { characterMatch } from './character-match';
import { coverage } from './coverage';
import { escalationProximity } from './escalation-proximity';
import { signalQuality } from './signal-quality';
import { summaryFaithfulness } from './summary-faithfulness';
import { toolSelection } from './tool-selection';
import type { Criterion } from './types';

export const criteriaRegistry: Record<string, Criterion> = {
  character_match: characterMatch,
  escalation_proximity: escalationProximity,
  coverage,
  artifact_validity: artifactValidity,
  signal_quality: signalQuality,
  summary_faithfulness: summaryFaithfulness,
  adversarial_resistance: adversarialResistance,
  tool_selection: toolSelection,
};

export type { Criterion, CriterionInput, CriterionScore } from './types';
