import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { apiClient, API_BASE_PATH } from "./client";
import { wsClient } from "./ws";
import type { LinesPage } from "../types/logLine";
import type {
  CreateSourceInput,
  Source,
  SourceFile,
  UpdateSourceInput,
  ValidateSourceInput,
  ValidateSourceResult,
} from "../types/source";

export const sourceKeys = {
  all: ["sources"] as const,
  detail: (id: string) => ["sources", id] as const,
  lines: (id: string, params: LinesParams) => ["sources", id, "lines", params] as const,
  files: (id: string) => ["sources", id, "files"] as const,
};

// ---- Plain REST calls -------------------------------------------------

export function fetchSources(): Promise<Source[]> {
  return apiClient.get<Source[]>("/sources");
}

export function fetchSource(id: string): Promise<Source> {
  return apiClient.get<Source>(`/sources/${encodeURIComponent(id)}`);
}

export function createSource(input: CreateSourceInput): Promise<Source> {
  return apiClient.post<Source>("/sources", input);
}

export function updateSource(id: string, input: UpdateSourceInput): Promise<Source> {
  return apiClient.put<Source>(`/sources/${encodeURIComponent(id)}`, input);
}

export function deleteSource(id: string): Promise<void> {
  return apiClient.delete<void>(`/sources/${encodeURIComponent(id)}`);
}

export function validateSource(input: ValidateSourceInput): Promise<ValidateSourceResult> {
  return apiClient.post<ValidateSourceResult>("/sources/validate", input);
}

export interface LinesParams {
  limit?: number;
  /** Smallest offset seen so far, to page further back into history. Omit for the tail-most page. */
  before?: number;
}

export function fetchSourceLines(id: string, params: LinesParams = {}): Promise<LinesPage> {
  return apiClient.get<LinesPage>(`/sources/${encodeURIComponent(id)}/lines`, {
    query: { limit: params.limit ?? 1000, before: params.before },
  });
}

export function fetchSourceFiles(id: string): Promise<SourceFile[]> {
  return apiClient.get<SourceFile[]>(`/sources/${encodeURIComponent(id)}/files`);
}

export function rollSource(id: string): Promise<void> {
  return apiClient.post<void>(`/sources/${encodeURIComponent(id)}/roll`);
}

/** Download is a plain browser navigation (not fetched here) so Content-Disposition drives the save dialog. */
export function sourceDownloadUrl(id: string, file: string): string {
  const params = new URLSearchParams({ file });
  return `${API_BASE_PATH}/sources/${encodeURIComponent(id)}/download?${params.toString()}`;
}

// ---- TanStack Query hooks ----------------------------------------------

export function useSources() {
  return useQuery({
    queryKey: sourceKeys.all,
    queryFn: fetchSources,
    refetchInterval: 30_000,
  });
}

export function useSource(id: string | undefined) {
  return useQuery({
    queryKey: sourceKeys.detail(id ?? ""),
    queryFn: () => fetchSource(id as string),
    enabled: !!id,
  });
}

export function useCreateSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createSource,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sourceKeys.all });
    },
  });
}

export function useUpdateSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateSourceInput }) => updateSource(id, input),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: sourceKeys.all });
      queryClient.invalidateQueries({ queryKey: sourceKeys.detail(variables.id) });
    },
  });
}

export function useDeleteSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteSource,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sourceKeys.all });
    },
  });
}

export function useValidateSource() {
  return useMutation({ mutationFn: validateSource });
}

export function useSourceLines(
  id: string | undefined,
  params: LinesParams = {},
  options?: Partial<UseQueryOptions<LinesPage>>,
) {
  return useQuery({
    queryKey: sourceKeys.lines(id ?? "", params),
    queryFn: () => fetchSourceLines(id as string, params),
    enabled: !!id,
    ...options,
  });
}

export function useSourceFiles(id: string | undefined) {
  return useQuery({
    queryKey: sourceKeys.files(id ?? ""),
    queryFn: () => fetchSourceFiles(id as string),
    enabled: !!id,
  });
}

export function useRollSource() {
  return useMutation({ mutationFn: rollSource });
}

/** Invalidates the sources list whenever the server reports its config changed elsewhere (e.g. another client). */
export function useSourcesChangedInvalidation(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    return wsClient.onMessage((msg) => {
      if (msg.type === "sourcesChanged") {
        queryClient.invalidateQueries({ queryKey: sourceKeys.all });
      }
    });
  }, [queryClient]);
}
