# WebToEpub website

This directory is the standalone website surface. It is intentionally separate from `plugin/`, so the existing Chrome/Firefox extension and its packaging process remain unchanged.

## Current status

The first milestone adds a responsive, accessible landing page and URL-entry interaction. URL validation is client-side. **It does not yet fetch stories or generate EPUB files.** The website must not present a successful conversion until the shared engine is connected.

## Why the engine needs an adapter

The extension's current runtime is not directly usable in an ordinary webpage:

- `HttpClient.js` and other modules call extension APIs and rely on extension permissions.
- `Download.js` uses `chrome.downloads` / `browser.downloads`; a website should instead expose the generated EPUB Blob through a normal browser download link.
- A website cannot freely fetch every novel host. Cross-origin resource sharing (CORS), cookies, anti-bot checks, and site-specific request headers differ from extension behavior.
- Some parsers use browser-only APIs such as declarative request rules. Those need an explicit web-compatible capability or a clearly reported unsupported status.

## Planned integration

1. Extract runtime-independent parser, content-cleaning, metadata, and EPUB-packing logic into shared modules without changing extension behavior.
2. Add a web runtime adapter for HTTP requests, preferences, progress/error reporting, and Blob downloads.
3. Add a parser registry build that can be loaded by the website while preserving the extension's existing parser registration.
4. Start with parsers that work with ordinary browser fetch and CORS-enabled sites; clearly report sites that need extension-only capabilities.
5. If a server fetch service is later needed, restrict it to HTTP(S), block private/local network destinations and redirects into them, enforce response-size/time limits, and do not build an unrestricted public URL proxy.
6. Add end-to-end tests for a supported public test page and EPUB validity before advertising website conversion as available.

## Local preview

Serve this folder with any static HTTP server, for example:

```sh
npx http-server web
```

Then open the local address printed by the server. The page is static and does not require an install step.
