// pnpm --filter roo-cline test api/providers/__tests__/zenmux.spec.ts

vitest.mock("vscode", () => ({}))

import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { ZenMuxHandler } from "../zenmux"
import { ApiHandlerOptions } from "../../../shared/api"
import { Package } from "../../../shared/package"

vitest.mock("openai")
vitest.mock("delay", () => ({ default: vitest.fn(() => Promise.resolve()) }))

const mockModels = {
	"anthropic/claude-sonnet-4": {
		maxTokens: 8192,
		contextWindow: 200000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 1,
		outputPrice: 10,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
		description: "Claude 4 Sonnet",
		thinking: false,
	},
	"anthropic/claude-sonnet-4.5": {
		maxTokens: 8192,
		contextWindow: 200000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsNativeTools: true,
		inputPrice: 3,
		outputPrice: 15,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
		description: "Claude 4.5 Sonnet",
		thinking: false,
	},
	"anthropic/claude-3.7-sonnet:thinking": {
		maxTokens: 128000,
		contextWindow: 200000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 3,
		outputPrice: 15,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
		description: "Claude 3.7 Sonnet with thinking",
	},
	"openai/gpt-5.2": {
		maxTokens: 16384,
		contextWindow: 128000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsNativeTools: true,
		inputPrice: 1,
		outputPrice: 10,
		description: "GPT-5.2",
	},
	"openai/o1": {
		maxTokens: 100000,
		contextWindow: 200000,
		supportsImages: true,
		supportsPromptCache: false,
		supportsNativeTools: true,
		inputPrice: 15,
		outputPrice: 60,
		description: "OpenAI o1",
		excludedTools: ["existing_excluded"],
		includedTools: ["existing_included"],
	},
}

vitest.mock("../fetchers/modelCache", () => ({
	getModels: vitest.fn().mockImplementation(() => {
		return Promise.resolve(mockModels)
	}),
	getModelsFromCache: vitest.fn((provider: string) => {
		if (provider === "zenmux") {
			return mockModels
		}
		return {}
	}),
}))

describe("ZenMuxHandler", () => {
	const mockOptions: ApiHandlerOptions = {
		zenMuxApiKey: "test-key",
		zenMuxModelId: "anthropic/claude-sonnet-4",
	}

	beforeEach(() => vitest.clearAllMocks())

	it("initializes with correct options", () => {
		const handler = new ZenMuxHandler(mockOptions)
		expect(handler).toBeInstanceOf(ZenMuxHandler)

		expect(OpenAI).toHaveBeenCalledWith({
			baseURL: "https://zenmux.ai/api/v1",
			apiKey: mockOptions.zenMuxApiKey,
			defaultHeaders: {
				"HTTP-Referer": "https://github.com/RooVetGit/Roo-Cline",
				"X-Title": "Roo Code",
				"User-Agent": `RooCode/${Package.version}`,
			},
		})
	})

	describe("fetchModel", () => {
		it("returns correct model info when options are provided", async () => {
			const handler = new ZenMuxHandler(mockOptions)
			const result = await handler.fetchModel()

			expect(result).toMatchObject({
				id: mockOptions.zenMuxModelId,
				info: {
					maxTokens: 8192,
					contextWindow: 200000,
					supportsImages: true,
					supportsPromptCache: true,
					inputPrice: 1,
					outputPrice: 10,
					cacheWritesPrice: 3.75,
					cacheReadsPrice: 0.3,
					description: "Claude 4 Sonnet",
					thinking: false,
				},
			})
		})

		it("returns default model info when options are not provided", async () => {
			const handler = new ZenMuxHandler({})
			const result = await handler.fetchModel()
			expect(result.id).toBe("openai/gpt-5.2")
			expect(result.info.supportsPromptCache).toBe(true)
			expect(result.info.supportsNativeTools).toBe(true)
		})
	})

	describe("createMessage", () => {
		it("generates correct stream chunks", async () => {
			const handler = new ZenMuxHandler(mockOptions)

			const mockStream = {
				async *[Symbol.asyncIterator]() {
					yield {
						id: mockOptions.zenMuxModelId,
						choices: [{ delta: { content: "test response" } }],
					}
					yield {
						id: "test-id",
						choices: [{ delta: {} }],
						usage: { prompt_tokens: 10, completion_tokens: 20, cost: 0.00021 },
					}
				},
			}

			// Mock OpenAI chat.completions.create
			const mockCreate = vitest.fn().mockResolvedValue(mockStream)

			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

			const systemPrompt = "test system prompt"
			const messages: Anthropic.Messages.MessageParam[] = [{ role: "user" as const, content: "test message" }]

			const generator = handler.createMessage(systemPrompt, messages)
			const chunks = []

			for await (const chunk of generator) {
				chunks.push(chunk)
			}

			// Verify stream chunks
			expect(chunks).toHaveLength(2) // One text chunk and one usage chunk
			expect(chunks[0]).toEqual({ type: "text", text: "test response" })
			expect(chunks[1]).toEqual({
				type: "usage",
				inputTokens: 10,
				outputTokens: 20,
				totalCost: 0.00021,
				cacheReadTokens: undefined,
				cacheWriteTokens: undefined,
			})

			// Verify OpenAI client was called with correct parameters.
			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					max_tokens: 8192,
					messages: [
						{
							content: "test system prompt",
							role: "system",
						},
						{
							content: "test message",
							role: "user",
						},
					],
					model: "anthropic/claude-sonnet-4",
					stream: true,
					stream_options: { include_usage: true },
					temperature: 0,
				}),
				undefined,
			)
		})

		it("captures telemetry when createMessage throws an exception", async () => {
			const handler = new ZenMuxHandler(mockOptions)
			const mockCreate = vitest.fn().mockRejectedValue(new Error("Connection failed"))
			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

			const generator = handler.createMessage("test", [])
			await expect(generator.next()).rejects.toThrow()
		})

		it("yields tool_call_end events when finish_reason is tool_calls", async () => {
			// Import NativeToolCallParser to set up state
			const { NativeToolCallParser } = await import("../../../core/assistant-message/NativeToolCallParser")

			// Clear any previous state
			NativeToolCallParser.clearRawChunkState()

			const handler = new ZenMuxHandler(mockOptions)

			const mockStream = {
				async *[Symbol.asyncIterator]() {
					yield {
						id: "test-id",
						choices: [
							{
								delta: {
									tool_calls: [
										{
											index: 0,
											id: "call_zenmux_test",
											function: { name: "read_file", arguments: '{"path":"test.ts"}' },
										},
									],
								},
								index: 0,
							},
						],
					}
					yield {
						id: "test-id",
						choices: [
							{
								delta: {},
								finish_reason: "tool_calls",
								index: 0,
							},
						],
						usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
					}
				},
			}

			const mockCreate = vitest.fn().mockResolvedValue(mockStream)
			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

			const generator = handler.createMessage("test", [])
			const chunks = []

			for await (const chunk of generator) {
				// Simulate what Task.ts does: when we receive tool_call_partial,
				// process it through NativeToolCallParser to populate rawChunkTracker
				if (chunk.type === "tool_call_partial") {
					NativeToolCallParser.processRawChunk({
						index: chunk.index,
						id: chunk.id,
						name: chunk.name,
						arguments: chunk.arguments,
					})
				}
				chunks.push(chunk)
			}

			// Should have tool_call_partial and tool_call_end
			const partialChunks = chunks.filter((chunk) => chunk.type === "tool_call_partial")
			const endChunks = chunks.filter((chunk) => chunk.type === "tool_call_end")

			expect(partialChunks).toHaveLength(1)
			expect(endChunks).toHaveLength(1)
			expect(endChunks[0].id).toBe("call_zenmux_test")
		})
	})
})
