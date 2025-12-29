import { useCallback } from "react"

import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import { zenMuxDefaultModelId, type ProviderSettings, type OrganizationAllowList } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"
import { useExtensionState } from "@src/context/ExtensionStateContext"

import { inputEventTransform } from "../transforms"
import { ModelPicker } from "../ModelPicker"

type ZenMuxProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
	simplifySettings?: boolean
}

export const ZenMux = ({
	apiConfiguration,
	setApiConfigurationField,
	organizationAllowList,
	modelValidationError,
	simplifySettings,
}: ZenMuxProps) => {
	const { t } = useAppTranslation()
	const { routerModels } = useExtensionState()

	const handleInputChange = useCallback(
		<K extends keyof ProviderSettings, E>(
			field: K,
			transform: (event: E) => ProviderSettings[K] = inputEventTransform,
		) =>
			(event: E | Event) => {
				setApiConfigurationField(field, transform(event as E))
			},
		[setApiConfigurationField],
	)

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.zenMuxApiKey || ""}
				type="password"
				onInput={handleInputChange("zenMuxApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.zenMuxApiKey")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{!apiConfiguration?.zenMuxApiKey && (
				<VSCodeButtonLink href="https://zenmux.ai/settings/keys" appearance="secondary">
					{t("settings:providers.getZenMuxApiKey")}
				</VSCodeButtonLink>
			)}

			<ModelPicker
				apiConfiguration={apiConfiguration}
				defaultModelId={zenMuxDefaultModelId}
				models={routerModels?.zenmux ?? {}}
				modelIdKey="zenMuxModelId"
				serviceName="ZenMux"
				serviceUrl="https://zenmux.ai/models"
				setApiConfigurationField={setApiConfigurationField}
				organizationAllowList={organizationAllowList}
				errorMessage={modelValidationError}
				simplifySettings={simplifySettings}
			/>
		</>
	)
}
