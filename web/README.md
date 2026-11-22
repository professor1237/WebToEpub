# WebToEpub website

This directory contains a standalone website surface. It is separate from `plugin/`, so the existing Chrome/Firefox extension and its packaging process remain unchanged.

## Current implementation

- Responsive landing page and story URL form.
- Browser-side URL validation and same-origin chapter-link discovery.
- A chapter selection workspace and editable title, author, and filename.
- A first browser-only conversion path that reuses the repository's existing `EpubMetaInfo`, `ChapterEpubItem`, `EpubItemSupplier`, and `EpubPacker` classes, plus the project's existing zip.js dependency.
- An initial Archive of Our Own (AO3) web adapter that ports the extension parser's chapter-navigation rules, work/series handling, story metadata, chapter content selector, and reader query flags.
- A small compatibility helper for the subset of shared EPUB code used by this path.

## Important limitations

This is an initial generic web conversion path, **not yet full parity with the extension**:

- Only AO3 has a dedicated website parser adapter so far; the website does not yet load the hundreds of site-specific parser classes. Those classes depend on extension-era globals, preferences, request interception, cookie handling, parser UI, and other extension services. Reusing them safely requires a proper runtime adapter and parser capability audit.
- Direct browser `fetch()` works only when the source site permits it through CORS. The AO3 adapter is integrated but has not yet passed a live browser conversion test; if AO3 does not allow credentialed cross-origin reads from the deployed website origin, the browser path will stop at the fetch step. CORS is controlled by the source server, not by this parser. Sites requiring extension host permissions, custom headers, partitioned-cookie handling, login workarounds, or anti-bot flows will not work in this web path.
- Chapter discovery currently lists same-origin links from the supplied page. It is a generic first pass and may include navigation or other non-chapter links. Review the selection before conversion.
- This first web path does not yet package chapter images, use site-specific chapter ordering, or support every extension parser's custom metadata and content cleanup.
- Do not add an unrestricted public URL proxy as a shortcut. Any future server-side fetcher must enforce HTTP(S), block private/local IP ranges (including after redirects and DNS resolution), limit response size and time, and apply abuse controls.

The extension remains the recommended option for sites that rely on its elevated permissions or site-specific parser behavior.

## Script loading

The website loads the existing ZIP library from `node_modules`, then the web compatibility helper, then the existing EPUB classes. Keep this order when changing `web/index.html`.

## Local preview

Install the repository dependencies at the repository root:

```sh
npm install
```

Then serve the repository root (not just the `web/` directory, because the website references the existing `plugin/` files and `node_modules/` ZIP library):

```sh
npx http-server . -p 8080
```

Open `http://localhost:8080/web/`.

## Next integration milestones

1. Create a formal web runtime contract for HTTP, preferences, cancellation, progress, errors, and file downloads.
2. Audit site parsers and mark their capabilities (ordinary CORS fetch, extension-only permissions, cookies, custom headers, background requests).
3. Validate the AO3 adapter in real browsers and add regression fixtures; then port or adapt selected parsers incrementally without changing the extension runtime.
4. Add image collection and EPUB image packaging to the web adapter.
5. Add chapter-order heuristics, better generic discovery, metadata handling, and a regression test set.
6. Only advertise support for sites that have passed real browser and EPUB validation.
