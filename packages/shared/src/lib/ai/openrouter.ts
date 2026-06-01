import { openrouterSettings } from "@agenticmind/shared/settings/openrouter-settings"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"

export const openrouterClient = createOpenRouter({
  apiKey: openrouterSettings.OPENROUTER_API_KEY,
})
