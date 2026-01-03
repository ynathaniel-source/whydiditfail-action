import * as core from "@actions/core";
export const MAX_LOG_BYTES = 400 * 1024;
export const MAX_REQUEST_BYTES = 450 * 1024;
export function byteLengthUtf8(s) {
    return Buffer.byteLength(s, "utf8");
}
export function validatePayloadSize(payload) {
    const body = JSON.stringify(payload);
    const bytes = byteLengthUtf8(body);
    if (bytes > MAX_REQUEST_BYTES) {
        throw new Error(`Request payload too large: ${bytes} bytes (max: ${MAX_REQUEST_BYTES} bytes). ` +
            `Try reducing max_log_kb or disabling verbose logging.`);
    }
    core.info(`Request payload size: ${bytes} bytes`);
}
