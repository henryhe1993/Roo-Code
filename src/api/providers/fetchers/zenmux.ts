import axios from "axios"
import { z } from "zod"

import { zenMuxDefaultModelInfo, type ModelInfo } from "@roo-code/types"

/**
 * ZenMuxModel
 */

export const zenMuxModelSchema = z.object({
	created: z.number(),
	id: z.string(),
	object: z.string(),
	owned_by: z.string(),
})

export type ZenMuxModel = z.infer<typeof zenMuxModelSchema>

const zenmuxModelsResponseSchema = z.object({
	data: z.array(zenMuxModelSchema),
})

type ZenMuxModelsResponse = z.infer<typeof zenmuxModelsResponseSchema>

/**
 * getZenMuxModels
 */

export async function getZenMuxModels(baseUrl?: string): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}
	const baseURL = baseUrl || "https://zenmux.ai/api/v1"

	try {
		const response = await axios.get<ZenMuxModelsResponse>(`${baseURL}/models`)
		const result = zenmuxModelsResponseSchema.safeParse(response.data)
		const data = result.success ? result.data.data : response.data.data

		if (!result.success) {
			console.error("ZenMux models query failed", result.error.format())
		}

		for (const model of data) {
			const { id } = model
			models[id] = {
				contextWindow: zenMuxDefaultModelInfo.contextWindow,
				supportsPromptCache: zenMuxDefaultModelInfo.supportsPromptCache,
			}
		}
	} catch (error) {
		console.error(
			`Error fetching ZenMux models: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
		)
	}

	return models
}
