// Converters for CLI option values: parseArgs hands every value over as a string.

function num(value, name) {
    const n = Number(value);
    if (value === undefined || value.trim() === '' || !Number.isFinite(n)) {
        throw new Error(`--${name} must be a number (got "${value}")`);
    }
    return n;
}

function positiveInt(value, name) {
    const n = num(value, name);
    if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a whole number >= 1 (got "${value}")`);
    return n;
}

function oneOf(value, name, allowed) {
    if (!allowed.includes(value)) throw new Error(`--${name} must be one of ${allowed.join(', ')} (got "${value}")`);
    return value;
}

// "lat,lng;lat,lng;..." -> [{ lat, lng }, ...]
function vertices(value, name) {
    const points = value.split(';').filter(pair => pair.trim()).map(pair => {
        const parts = pair.split(',');
        if (parts.length !== 2) throw new Error(`--${name} expects "lat,lng" pairs separated by ";" (got "${pair}")`);
        return { lat: num(parts[0], name), lng: num(parts[1], name) };
    });
    if (points.length < 3) throw new Error(`--${name} needs at least 3 points`);
    return points;
}

// "--target <url>[=<audience>]" values -> [{ url, host }]. The audience defaults to the URL's
// hostname; no targets means the env's DSS_TARGETS, or its own DSS if it has none.
function targets(list, cfg) {
    const entries = list?.length ? list : cfg.DSS_TARGETS;
    if (!entries?.length) return [{ url: cfg.DSS_BASE_URL, host: cfg.DSS_HOST }];
    return entries.map(entry => {
        const eq = entry.indexOf('=');
        const url = eq === -1 ? entry : entry.slice(0, eq);
        return { url, host: eq === -1 ? new URL(url).hostname : entry.slice(eq + 1) };
    });
}

module.exports = { num, positiveInt, oneOf, vertices, targets };
