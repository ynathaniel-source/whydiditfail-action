import * as core from "@actions/core";

export const MAX_LOG_BYTES = parseInt(process.env.ACTION_MAX_LOG_KB || '64', 10) * 1024;
export const MAX_REQUEST_BYTES = parseInt(process.env.ACTION_MAX_REQUEST_KB || '512', 10) * 1024;

export function byteLengthUtf8(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

export function validatePayloadSize(payload: any): void {
  const body = JSON.stringify(payload);
  const bytes = byteLengthUtf8(body);
  
  if (bytes > MAX_REQUEST_BYTES) {
    throw new Error(
      `Request payload too large: ${bytes} bytes (max: ${MAX_REQUEST_BYTES} bytes). ` +
      `Try reducing max_log_kb or disabling verbose logging.`
    );
  }
  
  core.info(`Request payload size: ${bytes} bytes`);
}
