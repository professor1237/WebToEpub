"use strict";

/*
 * Small browser adapter for the existing WebToEpub EPUB classes.
 * Parser/network adapters remain separate because extension permissions do not
 * exist on ordinary websites.
 */
window.UIText = {
    Default: {
        uuid: "https://webtoepub.example/",
        title: "WebToEpub book",
        author: "Unknown"
    },
    Error: {
        convertToXhtmlWarning: (title, url, error) => "Could not validate " + title + " (" + url + "): " + error
    }
};

window.ErrorLog = {
    log: (message) => console.warn(message)
};

const util = {
    XMLNS: "http://www.w3.org/1999/xhtml",
    extensionVersion: () => "web",
    styleSheetFileName: () => "OEBPS/Styles/stylesheet.css",
    clearIfDataUri: (value) => (value && value.startsWith("data:")) ? "" : value,
    getDefaultExtensionByMime: (mimeType) => ({
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/gif": "gif",
        "image/webp": "webp",
        "image/svg+xml": "svg",
        "image/avif": "avif",
        "image/bmp": "bmp"
    })[String(mimeType || "").split(";")[0].toLowerCase()] || "",
    zeroPad: (value) => ("000" + value).slice(-4),
    isNullOrEmpty: (value) => value == null || value === "",
    isHeaderTag: (node) => node?.nodeType === Node.ELEMENT_NODE && /^H[1-6]$/.test(node.tagName),
    safeForFileName: (value, maxLength = 120) => String(value || "web")
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength) || "web",
    makeStorageFileName: (directory, index, title, extension) => {
        const safeTitle = title ? "_" + util.safeForFileName(title, 120) + "." : ".";
        return directory + util.zeroPad(index) + safeTitle + extension;
    },
    sanitizeNode: (dirty) => {
        if (!dirty) return null;
        const clone = dirty.cloneNode(true);
        if (clone.nodeType === Node.ELEMENT_NODE) {
            const nodes = [clone, ...clone.querySelectorAll("*")];
            for (const element of nodes) {
                if (/^(SCRIPT|IFRAME|OBJECT|EMBED|FORM|INPUT|BUTTON|TEXTAREA|SELECT)$/i.test(element.tagName)) {
                    element.remove();
                    continue;
                }
                for (const attribute of [...element.attributes]) {
                    if (/^on/i.test(attribute.name) || ((attribute.name === "href" || attribute.name === "src") && /^\s*javascript:/i.test(attribute.value))) {
                        element.removeAttribute(attribute.name);
                    }
                }
            }
        }
        return clone;
    },
    createEmptyXhtmlDoc: () => {
        const doc = document.implementation.createDocument("http://www.w3.org/1999/xhtml", "html", null);
        const head = doc.createElementNS(util.XMLNS, "head");
        const title = doc.createElementNS(util.XMLNS, "title");
        head.appendChild(title);
        const body = doc.createElementNS(util.XMLNS, "body");
        doc.documentElement.append(head, body);
        return doc;
    },
    createEmptyHtmlDoc: () => document.implementation.createHTMLDocument(""),
    xmlToString: (doc) => new XMLSerializer().serializeToString(doc),
    isXhtmlInvalid: (source, mimeType = "application/xml") => {
        const parsed = new DOMParser().parseFromString(source, mimeType);
        const error = parsed.querySelector("parsererror");
        return error ? error.textContent : null;
    }
};

window.util = util;
