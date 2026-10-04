import type OverrideRule from '@server/entity/OverrideRule';

export const MAX_RULE_LOOKUP_IDS = 250;
export const KEYWORD_LOOKUP_CONCURRENCY = 10;
const MAX_RULE_LOOKUP_ID = 1_000_000_000;

const collectRuleIds = (
  rules: Pick<OverrideRule, 'users' | 'keywords'>[],
  field: 'users' | 'keywords'
): string[] =>
  [
    ...new Set(
      rules
        .flatMap((rule) => (rule[field] ? rule[field]!.split(',') : []))
        .filter((id) => {
          if (!/^\d+$/.test(id)) return false;
          const numericId = Number(id);
          return (
            Number.isSafeInteger(numericId) &&
            numericId > 0 &&
            numericId <= MAX_RULE_LOOKUP_ID
          );
        })
    ),
  ].slice(0, MAX_RULE_LOOKUP_IDS);

export const getOverrideRuleKeywordIds = (
  rules: Pick<OverrideRule, 'users' | 'keywords'>[]
): string[] => collectRuleIds(rules, 'keywords');

export const getOverrideRuleUserIds = (
  rules: Pick<OverrideRule, 'users' | 'keywords'>[]
): string[] => collectRuleIds(rules, 'users');
