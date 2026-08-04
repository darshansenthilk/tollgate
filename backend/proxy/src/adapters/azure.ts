import {
  AZURE_PRICES,
  credentialFieldsFor,
  type ProviderAdapter,
  type ProviderCost,
} from "@tollgate/shared";
import {
  extractOpenAiFormatToolCalls,
  injectOpenAiSystemPrompt,
  injectOpenAiToolDefinitions,
  parseOpenAiFormatCost,
  prepareStreamUsage,
} from "./openai-usage.js";

/**
 * Azure OpenAI.
 *
 * Same wire protocol as OpenAI — Azure hosts OpenAI's models and returns
 * byte-identical bodies — so metering and the streaming usage opt-in are
 * shared verbatim (see openai-usage.ts). Three things differ:
 *
 *  1. THE HOST IS PER-CUSTOMER. Every Azure OpenAI resource gets its own
 *     hostname, https://{resourceName}.openai.azure.com, so there is no
 *     single baseUrl to forward to — it comes from the org's stored
 *     credential (a non-secret `resourceName` config field). This is the
 *     reason the adapter seam takes a credential at all.
 *  2. AUTH IS `api-key`, not `Authorization: Bearer`. Azure ignores a bearer
 *     token entirely (that header is reserved for its Entra ID / AAD auth
 *     mode), so sending OpenAI's header shape fails with a 401 that looks
 *     like a bad key rather than a wrong scheme.
 *  3. THE MODEL LIVES IN THE PATH, not the body. Azure addresses a
 *     *deployment* (the customer's own name for a model they've provisioned):
 *     /openai/deployments/{deployment}/chat/completions?api-version=...
 *     The `model` field in the request body is ignored. The response still
 *     reports the real underlying model, which is what parseCost prices on.
 *
 * The mandatory ?api-version= query parameter is the caller's — Azure rejects
 * any request without one, and which version they pin changes the response
 * schema, so it is forwarded through untouched rather than defaulted here.
 */

/**
 * Re-check of the same pattern the api enforces at save time, taken from the
 * shared field definition so the two can't drift. Belt-and-braces because this
 * value becomes the upstream HOSTNAME: a stored config row containing a slash
 * or dot would send the org's traffic — and its api key — somewhere else
 * entirely. Cheap to verify here, catastrophic to assume.
 */
const RESOURCE_NAME =
  credentialFieldsFor("azure").find((f) => f.name === "resourceName")?.pattern ??
  /^[a-zA-Z0-9-]+$/;

export class AzureResourceMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AzureResourceMissingError";
  }
}

export const azureAdapter: ProviderAdapter = {
  slug: "azure",
  // Template, not a real host — see the per-customer note above. The actual
  // host is built per request from the credential's resourceName.
  baseUrl: "https://{resourceName}.openai.azure.com",

  buildUpstreamRequest: ({ path, query, credential }) => {
    const resourceName = credential.config["resourceName"];
    if (resourceName === undefined || !RESOURCE_NAME.test(resourceName)) {
      // Fail loudly rather than building a malformed URL: a bad resource name
      // would otherwise surface as an inscrutable DNS error against a host
      // that was never going to exist.
      throw new AzureResourceMissingError(
        "This Azure key has no valid resource name saved — re-save it in Settings with the name from https://<name>.openai.azure.com.",
      );
    }

    const clean = path.replace(/^\/+/, "");
    return {
      url: `https://${resourceName}.openai.azure.com/${clean}${query}`,
      headers: { "api-key": credential.secrets["apiKey"] ?? "" },
    };
  },

  prepareRequestBody: prepareStreamUsage,

  parseCost: (rawBody): ProviderCost => parseOpenAiFormatCost(rawBody, AZURE_PRICES),

  extractToolCalls: extractOpenAiFormatToolCalls,
  injectSystemPrompt: injectOpenAiSystemPrompt,
  injectToolDefinitions: injectOpenAiToolDefinitions,
};
