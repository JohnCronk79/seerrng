import TunerrAPI, {
  type TunerrRecordingRule,
  type TunerrRecordingRuleset,
  type TunerrRuleHistory,
  type TunerrSportsReport,
} from '@server/api/tunerr';
import type { TunerrSettings } from '@server/lib/settings';
import type { Readable } from 'node:stream';

/**
 * What SeerrNG needs from a Live TV backend: a guide stream, a recording-rule
 * store, and a sports report. Rule and report types keep their current names
 * because Tunerr is the only implementation today.
 */
export interface LiveTvProvider {
  openGuide(): Promise<Readable>;
  getRules(): Promise<TunerrRecordingRuleset>;
  getRuleHistory(): Promise<TunerrRuleHistory>;
  getSportsReport(): Promise<TunerrSportsReport>;
  missingFeatures(ruleset: TunerrRecordingRuleset): string[];
  upsertRule(rule: TunerrRecordingRule): Promise<unknown>;
  deleteRule(ruleId: string): Promise<unknown>;
}

/** Returns the configured Live TV backend. Tunerr is the only backend today. */
export const createLiveTvProvider = (
  settings: TunerrSettings
): LiveTvProvider => new TunerrAPI(settings);
