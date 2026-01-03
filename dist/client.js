export async function explainFailure(serviceUrl, payload, githubToken) {
    const url = `${serviceUrl.replace(/\/$/, "")}/v1/explain`;
    const headers = {
        "content-type": "application/json"
    };
    if (githubToken) {
        headers["authorization"] = `Bearer ${githubToken}`;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
        const res = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            if (res.status === 429) {
                const retryAfter = res.headers.get("retry-after");
                const resetTime = retryAfter ? ` (retry after ${retryAfter}s)` : "";
                throw new Error(`Rate limit exceeded${resetTime}. ` +
                    `This action does not retry automatically. ` +
                    `You've reached the monthly quota for this repository. ` +
                    `Response: ${text}`);
            }
            if (res.status === 413) {
                throw new Error(`Request payload too large (${res.status}). ` +
                    `The service rejected the request even after client-side truncation. ` +
                    `Try reducing max_log_kb further. ` +
                    `Response: ${text}`);
            }
            throw new Error(`Service error (${res.status}): ${text}`);
        }
        const result = await res.json();
        if (result.skipped) {
            throw new Error(`Analysis skipped by service. ` +
                `Reason: ${result.reason || "Low confidence or insufficient signal"}. ` +
                `No tokens were consumed.`);
        }
        return result;
    }
    finally {
        clearTimeout(timeout);
    }
}
