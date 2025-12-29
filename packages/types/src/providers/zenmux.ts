import type { ModelInfo } from "../model.js"

// ZenMux
// https://zenmux.ai/models
export const zenMuxDefaultModelId = "openai/gpt-5.2"

export const zenMuxDefaultModelInfo: ModelInfo = {
	contextWindow: 200_000,
	supportsPromptCache: true,
}
