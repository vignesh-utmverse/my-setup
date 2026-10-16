// Minimal fetch wrapper shared by every test. Resolves with { status, body } for any HTTP status
// (body is parsed JSON when possible, otherwise text) and rejects only on network errors and timeouts.
async function request(method, url, { token, json, form, timeoutMs = 30000 } = {}) {
    const headers = {};
    let body;
    if (token) headers.Authorization = `Bearer ${token}`;
    if (json !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(json);
    } else if (form !== undefined) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        body = new URLSearchParams(form).toString();
    }

    let res, text;
    try {
        res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
        text = await res.text();
    } catch (err) {
        // fetch hides the real reason (ECONNREFUSED, timeout, ...) in err.cause.
        throw new Error(`${method} ${url}: ${err.cause?.message || err.cause?.code || err.message}`);
    }

    try {
        return { status: res.status, body: text ? JSON.parse(text) : null };
    } catch {
        return { status: res.status, body: text };
    }
}

module.exports = { request };
