import Ajv from "ajv";
// biome-ignore lint/style/noRestrictedImports: schema.ts is the defining module, not a facade
import { OLOS_ERROR_SCHEMA } from "../schema";

const ajv = new Ajv({ strictSchema: false, validateFormats: false });
const validateOlosErrorEnvelope = ajv.compile({
  ...OLOS_ERROR_SCHEMA,
  $schema: undefined,
});

export async function expectOlosErrorEnvelope(
  response: Response
): Promise<void> {
  const body = await response.clone().json();

  if (!validateOlosErrorEnvelope(body)) {
    throw new Error(
      `response body does not match OLOS_ERROR_SCHEMA: ${JSON.stringify(
        validateOlosErrorEnvelope.errors
      )} for ${JSON.stringify(body)}`
    );
  }
}
