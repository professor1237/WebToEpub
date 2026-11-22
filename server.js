"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const dns = require("node:dns").promises;
const net = require("node:net");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || "127.0.0.1";
const AO3_HOSTS = new Set(["archiveofourown.org", "www.archiveofourown.org"]);
const MAX_HTML_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20000;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 30;
const requestsByIp = new Map();

const MIME_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".ico": "image/x-icon"
};

function sendJson(res, status, payload) {
    res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff"
    });
    res.end(JSON.stringify(payload));
}

function isPublicAddress(address) {
    const version = net.isIP(address);
    if (version === 4) {
        const parts = address.split(".").map(Number);
        const [a, b] = parts;
        return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 0) ||
            (a === 192 && b === 168) ||
            (a === 198 && (b === 18 || b === 19)) ||
            (a === 203 && b === 0));
    }
    if (version === 6) {
        const normalized = address.toLowerCase();
        return normalized === "::1" ? false :
            !(normalized === "::" || normalized.startsWith("fc") ||
                normalized.startsWith("fd") || normalized.startsWith("fe8") ||
                normalized.startsWith("fe9") || normalized.startsWith("fea") ||
                normalized.startsWith("feb") || normalized.startsWith("::ffff:"));
    }
    return false;
}

async function validateAo3Url(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error("Enter a valid AO3 story URL.");
    }
    if (url.protocol !== "https:" || !AO3_HOSTS.has(url.hostname) ||
        url.username || url.password || url.port) {
        throw new Error("Only HTTPS pages on archiveofourown.org are supported.");
    }
    if (!/^\/(works|series)\/\d+(\/|$)/.test(url.pathname)) {
        throw new Error("Use an AO3 work or series URL.");
    }
    url.hash = "";
    const addresses = await dns.lookup(url.hostname, {all: true, verbatim: true});
    if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) {
        throw new Error("AO3 hostname did not resolve to a public address.");
    }
    return url;
}

async function fetchAo3Page(initialUrl) {
    let currentUrl = initialUrl;
    for (let redirectCount = 0; redirectCount <= 5; redirectCount++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        let response;
        try {
            response = await fetch(currentUrl, {
                method: "GET",
                redirect: "manual",
                signal: controller.signal,
                headers: {
                    "user-agent": "WebToEpub/1.0 (personal EPUB reader; AO3-only fetch)",
                    "accept": "text/html,application/xhtml+xml"
                }
            });

        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get("location");
            if (!location || redirectCount === 5) {
                throw new Error("AO3 redirected too many times.");
            }
            currentUrl = await validateAo3Url(new URL(location, currentUrl).href);
            continue;
        }
        if (!response.ok) {
            throw new Error("AO3 returned HTTP " + response.status + ".");
        }
        const contentType = (response.headers.get("content-type") || "").toLowerCase();
        if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
            throw new Error("AO3 did not return an HTML page.");
        }
        const declaredLength = Number(response.headers.get("content-length") || 0);
        if (declaredLength > MAX_HTML_BYTES) {
            throw new Error("AO3 page is larger than the 8 MB limit.");
        }
        if (!response.body) throw new Error("AO3 returned an empty response.");
        const reader = response.body.getReader();
        const chunks = [];
        let total = 0;
        try {
            while (true) {
                const part = await reader.read();
                if (part.done) break;
                total += part.value.byteLength;
                if (total > MAX_HTML_BYTES) {
                    await reader.cancel();
                    throw new Error("AO3 page is larger than the 8 MB limit.");
                }
                chunks.push(part.value);
            }
        } finally {
            reader.releaseLock();
        }
        const html = Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString("utf8");
        return {url: currentUrl.href, html};
        } finally {
            clearTimeout(timeout);
        }
    }
    throw new Error("AO3 redirect limit exceeded.");
}

function isRateLimited(ip) {
    const now = Date.now();
    const recent = (requestsByIp.get(ip) || []).filter(timestamp => now - timestamp < RATE_WINDOW_MS);
    if (recent.length >= RATE_LIMIT) return true;
    recent.push(now);
    requestsByIp.set(ip, recent);
    return false;
}

async function handleAo3Api(req, res, requestUrl) {
    if (req.method !== "GET") {
        res.writeHead(405, {allow: "GET"});
        return res.end("Method not allowed");
    }
    const ip = req.socket.remoteAddress || "unknown";
    if (isRateLimited(ip)) return sendJson(res, 429, {error: "Too many requests. Wait a minute and try again."});
    try {
        const validated = await validateAo3Url(requestUrl.searchParams.get("url") || "");
        const page = await fetchAo3Page(validated);
        sendJson(res, 200, page);
    } catch (error) {
        const status = /Only HTTPS|valid AO3|Use an AO3|public address/.test(error.message) ? 400 : 502;
        sendJson(res, status, {error: error.name === "AbortError" ? "AO3 took too long to respond." : error.message});
    }
}

function serveStatic(req, res, requestUrl) {
    if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, {allow: "GET, HEAD"});
        return res.end("Method not allowed");
    }
    let pathname;
    try {
        pathname = decodeURIComponent(requestUrl.pathname);
    } catch {
        res.writeHead(400);
        return res.end("Bad request");
    }
    if (pathname === "/") pathname = "/web/";
    if (pathname === "/web" || pathname === "/web/") pathname = "/web/index.html";
    const filePath = path.resolve(ROOT, "." + pathname);
    if (!filePath.startsWith(ROOT + path.sep)) {
        res.writeHead(403);
        return res.end("Forbidden");
    }
    fs.stat(filePath, (statError, stat) => {
        if (statError || !stat.isFile()) {
            res.writeHead(404);
            return res.end("File not found");
        }
        res.writeHead(200, {
            "content-type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
            "content-length": stat.size,
            "x-content-type-options": "nosniff"
        });
        if (req.method === "HEAD") return res.end();
        fs.createReadStream(filePath).pipe(res);
    });
}

const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, "http://localhost");
    if (requestUrl.pathname === "/api/ao3") {
        void handleAo3Api(req, res, requestUrl);
    } else {
        serveStatic(req, res, requestUrl);
    }
});

server.listen(PORT, HOST, () => {
    console.log("WebToEpub is running at http://" + HOST + ":" + PORT + "/");
    console.log("AO3 fetch endpoint is restricted to archiveofourown.org work and series pages.");
});
