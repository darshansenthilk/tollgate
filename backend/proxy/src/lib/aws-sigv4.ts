import { AwsClient } from "aws4fetch";

/**
 * Signs a request for AWS Bedrock's InvokeModel API using aws4fetch — a
 * standalone SigV4 signer (no AWS SDK) built for fetch-based runtimes, which
 * this proxy already is. Kept as its own module rather than inlined in
 * bedrock.ts so the one fact that's easy to get wrong lives in exactly one
 * place, with the reasoning attached.
 *
 * THE SIGNING NAME IS "bedrock", NOT "bedrock-runtime". The hostname is
 * bedrock-runtime.{region}.amazonaws.com, and it is tempting to assume the
 * SigV4 credential-scope service name matches — several AWS docs and
 * third-party examples get this wrong. Confirmed against botocore's own
 * service model (the ground truth boto3 itself signs with):
 * botocore/data/bedrock-runtime/2023-09-30/service-2.json has
 * "endpointPrefix": "bedrock-runtime" but "signingName": "bedrock". Signing
 * with "bedrock-runtime" produces a request AWS rejects with
 * SignatureDoesNotMatch — a failure mode that gives no hint the service name
 * was the problem.
 */
const SIGNING_SERVICE = "bedrock";

export interface Sigv4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  /** Present only for temporary (STS) credentials. */
  sessionToken?: string;
}

/**
 * Returns headers to add to the request — Authorization plus whatever else
 * SigV4 requires (x-amz-date, x-amz-content-sha256, x-amz-security-token for
 * temporary credentials). The caller merges these over its own headers,
 * exactly like every other adapter's buildUpstreamRequest.
 */
export async function signAwsRequest(args: {
  credentials: Sigv4Credentials;
  region: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}): Promise<Record<string, string>> {
  const client = new AwsClient({
    accessKeyId: args.credentials.accessKeyId,
    secretAccessKey: args.credentials.secretAccessKey,
    sessionToken: args.credentials.sessionToken,
    service: SIGNING_SERVICE,
    region: args.region,
  });

  const signed = await client.sign(args.url, {
    method: args.method,
    headers: args.headers,
    body: args.body,
  });

  const out: Record<string, string> = {};
  signed.headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}
