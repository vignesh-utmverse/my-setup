# DSS Token Authentication

A Node.js utility for obtaining OAuth tokens for DSS (Discovery and Synchronization Service) API authentication using Google Service Account credentials.


## Files

| File | Description |
|------|-------------|
| `token.js` | Main module exporting token functions |
| `saKey.json` | Google Service Account credentials (not included) |
| `tokenCache.json` | Auto-generated token cache file |
| `test.js` | Usage example |

## Setup

1. Place your Google Service Account key file as `saKey.json` in this directory
2. Ensure the service account has appropriate permissions

## Usage

Refer to test.js

## API Reference

### `dssToken(audience, scope, gScope?)`

Obtains a DSS access token.

| Parameter | Type | Description |
|-----------|------|-------------|
| `audience` | string | Target DSS hostname (e.g., `'prequal-dss.utmverse.com'`) |
| `scope` | string | DSS scope (e.g., `'utm.availability_arbitration'`) |
| `gScope` | string | Google OAuth scope (default: `'email'`) |

**Returns:** `Promise<string>` - The access token

### `googleToken(scope)`

Obtains a Google OAuth access token using service account credentials.

| Parameter | Type | Description |
|-----------|------|-------------|
| `scope` | string | Google OAuth scope |

**Returns:** `Promise<string>` - The Google access token

## Token Caching

Tokens are automatically cached in `tokenCache.json` to avoid unnecessary token requests. The cache includes:
- Token expiration tracking (with 60-second buffer)
- Scope and audience validation
- Automatic refresh when expired
