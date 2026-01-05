interface RetryOptions {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function shouldRetry(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504 || status === 408;
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retryOptions: RetryOptions = { maxRetries: 3, initialDelayMs: 1000, maxDelayMs: 10000 }
): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= retryOptions.maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      
      if (response.ok || !shouldRetry(response.status)) {
        return response;
      }
      
      if (attempt < retryOptions.maxRetries) {
        const retryAfter = response.headers.get('retry-after');
        let delayMs: number;
        
        if (retryAfter) {
          const retryAfterSeconds = parseInt(retryAfter, 10);
          delayMs = isNaN(retryAfterSeconds) ? retryOptions.initialDelayMs : retryAfterSeconds * 1000;
        } else {
          delayMs = Math.min(
            retryOptions.initialDelayMs * Math.pow(2, attempt),
            retryOptions.maxDelayMs
          );
          delayMs += Math.random() * 1000;
        }
        
        await sleep(delayMs);
        continue;
      }
      
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < retryOptions.maxRetries) {
        const delayMs = Math.min(
          retryOptions.initialDelayMs * Math.pow(2, attempt),
          retryOptions.maxDelayMs
        ) + Math.random() * 1000;
        
        await sleep(delayMs);
        continue;
      }
    }
  }
  
  throw lastError || new Error('Max retries exceeded');
}

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
    const res = await fetchWithRetry(url, {
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
    
    const limit = res.headers.get('x-ratelimit-limit');
    const remaining = res.headers.get('x-ratelimit-remaining');
    const resetAt = res.headers.get('x-ratelimit-reset');
    
    if (limit) result.limit = parseInt(limit, 10);
    if (remaining) result.remaining = parseInt(remaining, 10);
    if (resetAt) result.reset_at = new Date(parseInt(resetAt, 10) * 1000).toISOString();
    
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
