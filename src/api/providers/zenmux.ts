import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { zenMuxDefaultModelId, zenMuxDefaultModelInfo } from "@roo-code/types"

import { XmlMatcher } from "../../utils/xml-matcher"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { handleOpenAIError } from "./utils/openai-error-handler"
import { calculateApiCostOpenAI } from "../../shared/cost"
import type { ApiHandlerCreateMessageMetadata } from "../index"
import { type ApiHandlerOptions, getModelMaxOutputTokens } from "../../shared/api"
import { RouterProvider } from "./router-provider"

export class ZenMuxHandler extends RouterProvider {
	defaultTemperature = 0

	constructor(options: ApiHandlerOptions) {
		super({
			options,
			name: "zenmux",
			baseURL: options.zenMuxBaseUrl || "https://zenmux.ai/api/v1",
			apiKey: options.zenMuxApiKey ?? "",
			modelId: options.zenMuxModelId,
			defaultModelId: zenMuxDefaultModelId,
			defaultModelInfo: zenMuxDefaultModelInfo,
		})
	}

	protected createStream(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
		requestOptions?: OpenAI.RequestOptions,
	) {
		const { id: model, info } = this.getModel()

		const max_tokens =
			getModelMaxOutputTokens({
				modelId: model,
				model: info,
				settings: this.options,
				format: "openai",
			}) ?? undefined

		const temperature = this.options.modelTemperature ?? this.defaultTemperature

		const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
			model,
			max_tokens,
			temperature,
			messages: [
				{ role: "system", content: systemPrompt },
				...convertToOpenAiMessages(messages, { mergeToolResultText: true }),
			],
			stream: true,
			stream_options: { include_usage: true },
			...(metadata?.tools && { tools: this.convertToolsForOpenAI(metadata.tools) }),
			...(metadata?.tool_choice && { tool_choice: metadata.tool_choice }),
			...(metadata?.toolProtocol === "native" && {
				parallel_tool_calls: metadata.parallelToolCalls ?? false,
			}),
		}

		if (this.options.enableReasoningEffort && info.supportsReasoningBinary) {
			;(params as any).thinking = { type: "enabled" }
		}

		try {
			return this.client.chat.completions.create(params, requestOptions)
		} catch (error) {
			throw handleOpenAIError(error, this.name)
		}
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const stream = await this.createStream(systemPrompt, messages, metadata)

		const matcher = new XmlMatcher(
			"think",
			(chunk) =>
				({
					type: chunk.matched ? "reasoning" : "text",
					text: chunk.data,
				}) as const,
		)

		let lastUsage: OpenAI.CompletionUsage | undefined
		const activeToolCallIds = new Set<string>()

		for await (const chunk of stream) {
			const chunkAny = chunk as any
			if (chunkAny.base_resp?.status_code && chunkAny.base_resp.status_code !== 0) {
				throw new Error(
					`${this.name} API Error (${chunkAny.base_resp.status_code}): ${chunkAny.base_resp.status_msg || "Unknown error"}`,
				)
			}

			const delta = chunk.choices?.[0]?.delta
			const finishReason = chunk.choices?.[0]?.finish_reason

			if (delta?.content) {
				for (const processedChunk of matcher.update(delta.content)) {
					yield processedChunk
				}
			}

			if (delta) {
				for (const key of ["reasoning_content", "reasoning"] as const) {
					if (key in delta) {
						const reasoning_content = ((delta as any)[key] as string | undefined) || ""
						if (reasoning_content?.trim()) {
							yield { type: "reasoning", text: reasoning_content }
						}
						break
					}
				}
			}

			if (delta?.tool_calls) {
				for (const toolCall of delta.tool_calls) {
					if (toolCall.id) {
						activeToolCallIds.add(toolCall.id)
					}
					yield {
						type: "tool_call_partial",
						index: toolCall.index,
						id: toolCall.id,
						name: toolCall.function?.name,
						arguments: toolCall.function?.arguments,
					}
				}
			}

			if (finishReason === "tool_calls" && activeToolCallIds.size > 0) {
				for (const id of activeToolCallIds) {
					yield { type: "tool_call_end", id }
				}
				activeToolCallIds.clear()
			}

			if (chunk.usage) {
				lastUsage = chunk.usage
			}
		}

		if (lastUsage) {
			yield this.processUsageMetrics(lastUsage, this.getModel().info)
		}

		for (const processedChunk of matcher.final()) {
			yield processedChunk
		}
	}

	protected processUsageMetrics(usage: any, modelInfo?: any): ApiStreamUsageChunk {
		const inputTokens = usage?.prompt_tokens || 0
		const outputTokens = usage?.completion_tokens || 0
		const cacheWriteTokens = usage?.prompt_tokens_details?.cache_write_tokens || 0
		const cacheReadTokens = usage?.prompt_tokens_details?.cached_tokens || 0

		const { totalCost } = modelInfo
			? calculateApiCostOpenAI(modelInfo, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)
			: { totalCost: 0 }

		return {
			type: "usage",
			inputTokens,
			outputTokens,
			cacheWriteTokens: cacheWriteTokens || undefined,
			cacheReadTokens: cacheReadTokens || undefined,
			totalCost,
		}
	}
}
