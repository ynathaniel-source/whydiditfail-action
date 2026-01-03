export async function explainFailure(serviceUrl, payload) {
    const url = `${serviceUrl.replace(/\/$/, "")}/v1/explain`;
    const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Explain service error (${res.status}): ${text}`);
    }
    return res.json();
}
