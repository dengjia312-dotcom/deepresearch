import type { ResearchRequest, ResearchResponse } from '../types/research'
import {
  retrieveResearchSourcesWithGlm,
  type GlmReaderStatus,
} from './glmResearchRetrievalService'
import { synthesizeResearchResponse } from './researchSynthesisService'

export interface ResearchExecutionHooks {
  onSearchStarted?: () => Promise<void> | void
  onSearchCompleted?: (validSourceCount: number) => Promise<void> | void
  onReaderStarted?: (readerTargetCount: number) => Promise<void> | void
  onReaderCompleted?: (status: GlmReaderStatus) => Promise<void> | void
  onSynthesisStarted?: () => Promise<void> | void
}

export async function researchWithProviders(
  request: ResearchRequest,
  hooks: ResearchExecutionHooks = {},
): Promise<ResearchResponse> {
  await hooks.onSearchStarted?.()
  const retrieval = await retrieveResearchSourcesWithGlm(request, {
    onSearchCompleted: hooks.onSearchCompleted,
    onReaderStarted: hooks.onReaderStarted,
    onReaderCompleted: hooks.onReaderCompleted,
  })
  await hooks.onSynthesisStarted?.()
  return synthesizeResearchResponse(
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
