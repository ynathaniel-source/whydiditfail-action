export async function explainFailure(serviceUrl: string, payload: any, githubToken?: string): Promise<any> {
  const url = `${serviceUrl.replace(/\/$/, "")}/v1/explain`;
  
  const headers: Record<string, string> = {
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
        try {
          const errorData = JSON.parse(text);
          return {
            rate_limited: true,
            limit: errorData.limit,
            remaining: errorData.remaining,
            reset_at: errorData.reset_at
          };
        } catch {
          return {
            rate_limited: true,
            message: text
          };
        }
      }
      
      if (res.status === 413) {
        throw new Error(
          `Request payload too large (${res.status}). ` +
          `The service rejected the request even after client-side truncation. ` +
          `Try reducing max_log_kb further. ` +
          `Response: ${text}`
        );
      }
      
      throw new Error(`Service error (${res.status}): ${text}`);
    }
    
    const result = await res.json();
    
    if (result.skipped) {
      throw new Error(
        `Analysis skipped by service. ` +
        `Reason: ${result.reason || "Low confidence or insufficient signal"}. ` +
        `No tokens were consumed.`
      );
    }
    
    const inGracePeriod = res.headers.get('x-ratelimit-grace-period') === 'true';
    const graceRemaining = res.headers.get('x-ratelimit-grace-remaining');
    
    if (inGracePeriod && graceRemaining) {
      result.grace_period = {
        active: true,
        remaining: parseInt(graceRemaining, 10)
      };
    }
    
    return result;
  } finally {
    clearTimeout(timeout);
  }
}
