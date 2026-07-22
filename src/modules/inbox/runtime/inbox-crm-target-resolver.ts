export type DefaultPipelineCandidate = {
  id: string;
  businessMode: string;
};

export function resolveDefaultPipelineForBusinessMode<
  T extends DefaultPipelineCandidate,
>(pipelines: T[], businessMode: string): T | null {
  const exact = pipelines.filter(
    (pipeline) => pipeline.businessMode === businessMode,
  );
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  const general = pipelines.filter(
    (pipeline) => pipeline.businessMode === 'general',
  );
  return general.length === 1 ? general[0] : null;
}
