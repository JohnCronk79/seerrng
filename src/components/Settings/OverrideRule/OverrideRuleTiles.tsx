import type { DVRTestResponse } from '@app/components/Settings/SettingsServices';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { PencilIcon, TrashIcon } from '@heroicons/react/24/solid';
import type { TmdbGenre } from '@server/api/themoviedb/interfaces';
import type OverrideRule from '@server/entity/OverrideRule';
import type { User } from '@server/entity/User';
import type {
  Language,
  LidarrSettings,
  RadarrSettings,
  SonarrSettings,
} from '@server/lib/settings';
import type { Keyword } from '@server/models/common';
import axios from 'axios';
import { useCallback, useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';
import {
  KEYWORD_LOOKUP_CONCURRENCY,
  getOverrideRuleKeywordIds,
  getOverrideRuleUserIds,
} from './ruleLookups';

const messages = defineMessages('components.Settings.OverrideRuleTile', {
  qualityprofile: 'Quality Profile',
  rootfolder: 'Root Folder',
  tags: 'Tags',
  users: 'Users',
  genre: 'Genre',
  language: 'Language',
  keywords: 'Keywords',
  conditions: 'Conditions',
  settings: 'Settings',
});

interface OverrideRuleTilesProps {
  rules: OverrideRule[];
  setOverrideRuleModal: ({
    open,
    rule,
  }: {
    open: boolean;
    rule: OverrideRule | null;
  }) => void;
  revalidate: () => void;
  radarrServices: RadarrSettings[];
  sonarrServices: SonarrSettings[];
  lidarrServices: LidarrSettings[];
}

const OverrideRuleTiles = ({
  rules,
  setOverrideRuleModal,
  revalidate,
  radarrServices,
  sonarrServices,
  lidarrServices,
}: OverrideRuleTilesProps) => {
  const intl = useIntl();
  const [users, setUsers] = useState<User[] | null>(null);
  const [keywords, setKeywords] = useState<Keyword[] | null>(null);
  const { data: languages } = useSWR<Language[]>('/api/v1/languages');
  const { data: genres } = useSWR<TmdbGenre[]>('/api/v1/genres/movie');
  const [testResponses, setTestResponses] = useState<
    (DVRTestResponse & { type: string; id: number })[]
  >([]);

  const getServiceInfos = useCallback(
    async (signal: AbortSignal) => {
      const results: (DVRTestResponse & { type: string; id: number })[] = [];
      const services = [
        ...radarrServices.map((service) => ({
          service,
          type: 'radarr' as const,
          referenced: rules.some((rule) => rule.radarrServiceId === service.id),
        })),
        ...sonarrServices.map((service) => ({
          service,
          type: 'sonarr' as const,
          referenced: rules.some((rule) => rule.sonarrServiceId === service.id),
        })),
        ...lidarrServices.map((service) => ({
          service,
          type: 'lidarr' as const,
          referenced: rules.some((rule) => rule.lidarrServiceId === service.id),
        })),
      ].filter(({ referenced }) => referenced);
      for (const { service, type } of services) {
        const { hostname, port, apiKey, baseUrl, useSsl = false } = service;
        try {
          const response = await axios.post<DVRTestResponse>(
            `/api/v1/settings/${type}/test`,
            {
              id: service.id,
              hostname,
              apiKey,
              port: Number(port),
              baseUrl,
              useSsl,
            },
            { signal }
          );
          results.push({
            type,
            id: service.id,
            ...response.data,
          });
        } catch {
          if (signal.aborted) {
            break;
          }
          results.push({
            type,
            id: service.id,
            profiles: [],
            rootFolders: [],
            tags: [],
          });
        }
      }
      return results;
    },
    [lidarrServices, radarrServices, rules, sonarrServices]
  );

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const loadServiceInfos = async () => {
      const results = await getServiceInfos(controller.signal);
      if (active) {
        setTestResponses(results);
      }
    };

    void loadServiceInfos();
    return () => {
      active = false;
      controller.abort();
    };
  }, [getServiceInfos]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    (async () => {
      const keywordIds = getOverrideRuleKeywordIds(rules);
      const loadedKeywords: Keyword[] = [];
      for (
        let offset = 0;
        offset < keywordIds.length;
        offset += KEYWORD_LOOKUP_CONCURRENCY
      ) {
        const batch = await Promise.all(
          keywordIds
            .slice(offset, offset + KEYWORD_LOOKUP_CONCURRENCY)
            .map((keywordId) =>
              axios
                .get<Keyword | null>(`/api/v1/keyword/${keywordId}`, {
                  signal: controller.signal,
                })
                .then((response) => response.data)
                .catch(() => null)
            )
        );
        loadedKeywords.push(
          ...batch.filter((keyword): keyword is Keyword => keyword !== null)
        );
        if (controller.signal.aborted) {
          return;
        }
      }
      if (active) {
        setKeywords(loadedKeywords);
      }

      const userIds = getOverrideRuleUserIds(rules);
      if (userIds.length > 0) {
        const response = await axios
          .get(
            `/api/v1/user?includeIds=${encodeURIComponent(userIds.join(','))}`,
            { signal: controller.signal }
          )
          .catch(() => undefined);
        if (active) {
          setUsers((response?.data.results as User[] | undefined) ?? []);
        }
      } else if (active) {
        setUsers([]);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [rules]);

  return (
    <>
      {rules.map((rule) => (
        <li
          key={rule.id}
          className="flex h-full flex-col rounded-lg bg-gray-800 text-left shadow ring-1 ring-gray-500"
        >
          <div className="flex w-full flex-1 items-center justify-between space-x-6 p-6">
            <div className="flex-1 truncate">
              <span className="text-lg">
                {intl.formatMessage(messages.conditions)}
              </span>
              {rule.users && (
                <p className="truncate text-sm leading-5 text-gray-300">
                  <span className="mr-2 font-bold">
                    {intl.formatMessage(messages.users)}
                  </span>
                  <div className="inline-flex gap-2">
                    {rule.users.split(',').map((userId) => {
                      return (
                        <span key={userId}>
                          {users?.find((user) => user.id === Number(userId))
                            ?.displayName ?? userId}
                        </span>
                      );
                    })}
                  </div>
                </p>
              )}
              {rule.genre && (
                <p className="truncate text-sm leading-5 text-gray-300">
                  <span className="mr-2 font-bold">
                    {intl.formatMessage(messages.genre)}
                  </span>
                  <div className="inline-flex gap-2">
                    {rule.genre.split(',').map((genreId) => (
                      <span key={genreId}>
                        {genres?.find((g) => g.id === Number(genreId))?.name}
                      </span>
                    ))}
                  </div>
                </p>
              )}
              {rule.language && (
                <p className="truncate text-sm leading-5 text-gray-300">
                  <span className="mr-2 font-bold">
                    {intl.formatMessage(messages.language)}
                  </span>
                  <div className="inline-flex gap-2">
                    {rule.language
                      .split('|')
                      .filter((languageId) => languageId !== 'server')
                      .map((languageId) => {
                        const language = languages?.find(
                          (language) => language.iso_639_1 === languageId
                        );
                        if (!language) return null;
                        const languageName =
                          intl.formatDisplayName(language.iso_639_1, {
                            type: 'language',
                            fallback: 'none',
                          }) ?? language.english_name;
                        return <span key={languageId}>{languageName}</span>;
                      })}
                  </div>
                </p>
              )}
              {rule.keywords && (
                <p className="truncate text-sm leading-5 text-gray-300">
                  <span className="mr-2 font-bold">
                    {intl.formatMessage(messages.keywords)}
                  </span>
                  <div className="inline-flex gap-2">
                    {rule.keywords.split(',').map((keywordId) => {
                      return (
                        <span key={keywordId}>
                          {keywords?.find(
                            (keyword) => keyword.id === Number(keywordId)
                          )?.name ?? keywordId}
                        </span>
                      );
                    })}
                  </div>
                </p>
              )}
              <span className="text-lg">
                {intl.formatMessage(messages.settings)}
              </span>
              {rule.profileId != null && (
                <p className="runcate text-sm leading-5 text-gray-300">
                  <span className="mr-2 font-bold">
                    {intl.formatMessage(messages.qualityprofile)}
                  </span>
                  {testResponses
                    .find(
                      (r) =>
                        (r.id === rule.radarrServiceId &&
                          r.type === 'radarr') ||
                        (r.id === rule.sonarrServiceId &&
                          r.type === 'sonarr') ||
                        (r.id === rule.lidarrServiceId && r.type === 'lidarr')
                    )
                    ?.profiles.find((profile) => rule.profileId === profile.id)
                    ?.name || rule.profileId}
                </p>
              )}
              {rule.rootFolder && (
                <p className="truncate text-sm leading-5 text-gray-300">
                  <span className="mr-2 font-bold">
                    {intl.formatMessage(messages.rootfolder)}
                  </span>
                  {rule.rootFolder}
                </p>
              )}
              {rule.tags && rule.tags.length > 0 && (
                <p className="truncate text-sm leading-5 text-gray-300">
                  <span className="mr-2 font-bold">
                    {intl.formatMessage(messages.tags)}
                  </span>
                  <div className="inline-flex gap-2">
                    {rule.tags.split(',').map((tag) => (
                      <span key={tag}>
                        {testResponses
                          .find(
                            (r) =>
                              (r.id === rule.radarrServiceId &&
                                r.type === 'radarr') ||
                              (r.id === rule.sonarrServiceId &&
                                r.type === 'sonarr') ||
                              (r.id === rule.lidarrServiceId &&
                                r.type === 'lidarr')
                          )
                          ?.tags?.find((t) => t.id === Number(tag))?.label ||
                          tag}
                      </span>
                    ))}
                  </div>
                </p>
              )}
            </div>
          </div>
          <div className="border-t border-gray-500">
            <div className="-mt-px flex">
              <div className="flex w-0 flex-1 border-r border-gray-500">
                <button
                  onClick={() => setOverrideRuleModal({ open: true, rule })}
                  className="focus:ring-blue relative -mr-px inline-flex w-0 flex-1 items-center justify-center rounded-bl-lg border border-transparent py-4 text-sm leading-5 font-medium text-gray-200 transition duration-150 ease-in-out hover:text-white focus:z-10 focus:border-gray-500 focus:outline-none"
                >
                  <PencilIcon className="mr-2 h-5 w-5" />
                  <span>{intl.formatMessage(globalMessages.edit)}</span>
                </button>
              </div>
              <div className="-ml-px flex w-0 flex-1">
                <button
                  onClick={async () => {
                    await axios.delete(`/api/v1/overrideRule/${rule.id}`);
                    revalidate();
                  }}
                  className="focus:ring-blue relative inline-flex w-0 flex-1 items-center justify-center rounded-br-lg border border-transparent py-4 text-sm leading-5 font-medium text-gray-200 transition duration-150 ease-in-out hover:text-white focus:z-10 focus:border-gray-500 focus:outline-none"
                >
                  <TrashIcon className="mr-2 h-5 w-5" />
                  <span>{intl.formatMessage(globalMessages.delete)}</span>
                </button>
              </div>
            </div>
          </div>
        </li>
      ))}
    </>
  );
};

export default OverrideRuleTiles;
