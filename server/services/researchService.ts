import type { ResearchRequest, ResearchResponse } from '../types/research'
import { retrieveResearchSourcesWithGlm } from './glmResearchRetrievalService'
import { synthesizeResearchResponseWithMimo } from './mimoResearchService'

export async function researchWithProviders(
  request: ResearchRequest,
): Promise<ResearchResponse> {
  const retrieval = await retrieveResearchSourcesWithGlm(request)
  return synthesizeResearchResponseWithMimo(
    request,
    retrieval.metadata,
    retrieval.evidenceSources,
    {
      actualSourceCount: retrieval.actualSourceCount,
      deduplicatedSourceCount: retrieval.deduplicatedSourceCount,
    },
    retrieval.warnings,
  )
}
