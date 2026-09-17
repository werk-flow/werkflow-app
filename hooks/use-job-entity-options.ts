'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOrganization } from '@/components/organization/organization-context';
import { useUserProfile } from '@/components/user/user-profile-context';
import { searchJobEntityOptions } from '@/lib/jobs/option-actions';
import type { JobEntityOption, JobOptionRequest } from '@/lib/jobs/option-types';

type Request = Pick<JobOptionRequest, 'kind' | 'purpose' | 'clientId' | 'projectId'>;
export type JobEntityOptionsState = {
  options: JobEntityOption[];
  onSearchChange: (query: string) => void;
  loading: boolean;
  loadError: string | undefined;
  onLoadMore: (() => void) | undefined;
};

/** Page choices independently of the displayed list; retained selection is explicit. */
export function useJobEntityOptions(request: Request, selectedIds: string[], initial: JobEntityOption[] = []): JobEntityOptionsState {
  const { activeOrgId, activeOrg } = useOrganization();
  const { profile } = useUserProfile();
  const scopeKey = `${activeOrgId}:${profile?.id}:${activeOrg?.role}:${request.kind}:${request.purpose}:${request.clientId}:${request.projectId}`;
  const [initialScope] = useState(scopeKey);
  const [search, setSearch] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ scopeKey: string; options: JobEntityOption[]; hasMore: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  const selectedKey = JSON.stringify(selectedIds);
  const searchFor = useCallback((query: string) => { setSearch(query); setOffset(0); setPending(true); setRevision((current) => current + 1); }, []);

  useEffect(() => {
    if (!activeOrgId || (search === null && selectedKey === '[]')) return;
    const current = ++generation.current;
    const timer = setTimeout(() => {
      setPending(true);
      setFailed(false);
      void searchJobEntityOptions({ ...request, organizationId: activeOrgId, query: search ?? '', offset, selectedIds: JSON.parse(selectedKey) as string[] })
        .then((response) => {
          if (current !== generation.current) return;
          if (!response.success) { setFailed(true); return; }
          setResult((previous) => {
            const retained = offset > 0 && previous?.scopeKey === scopeKey ? previous.options : [];
            const options = [...new Map([...retained, ...response.options, ...response.selected].map((option) => [option.value, option])).values()];
            return { scopeKey, options, hasMore: response.hasMore };
          });
        })
        .catch(() => { if (current === generation.current) setFailed(true); })
        .finally(() => { if (current === generation.current) setPending(false); });
    }, search ? 150 : 0);
    return () => { clearTimeout(timer); generation.current += 1; };
  // Primitive scope fields define this request; callers need not memoize its object.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the primitive scope fields above define the request
  }, [scopeKey, activeOrgId, search, offset, selectedKey, revision]);

  const options = useMemo(() => result?.scopeKey === scopeKey ? result.options : scopeKey === initialScope ? initial : [], [result, scopeKey, initialScope, initial]);
  return {
    options,
    onSearchChange: searchFor,
    loading: pending,
    loadError: failed ? 'Die Auswahl konnte nicht geladen werden. Bitte erneut suchen.' : undefined,
    onLoadMore: result?.scopeKey === scopeKey && result.hasMore ? () => setOffset((current) => current + 50) : undefined,
  };
}
