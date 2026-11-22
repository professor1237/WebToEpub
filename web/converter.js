"use strict";

const form = document.getElementById("url-form");
const urlInput = document.getElementById("story-url");
const status = document.getElementById("form-status");
const workspace = document.getElementById("converter-workspace");
const chapterList = document.getElementById("chapter-list");
const chapterCount = document.getElementById("chapter-count");
const convertButton = document.getElementById("convert-button");
const selectAllButton = document.getElementById("select-all-chapters");
const bookTitle = document.getElementById("book-title");
const bookAuthor = document.getElementById("book-author");
const fileName = document.getElementById("book-filename");
const conversionStatus = document.getElementById("conversion-status");
const chapterProgress = document.getElementById("chapter-progress");

let discoveredChapters = [];
let sourceDocument = null;
let sourceUrl = null;
let activeParser = null;
let storyMetadata = null;
let collectedImages = [];
let imageByUrl = new Map();
let skippedImageCount = 0;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 100 * 1024 * 1024;
let totalImageBytes = 0;

function setStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle("is-error", isError);
}

function setConversionStatus(message, isError = false) {
    conversionStatus.textContent = message;
    conversionStatus.classList.toggle("is-error", isError);
}

function safeUrl(value, base) {
    try {
        const url = new URL(value, base);
        return ["http:", "https:"].includes(url.protocol) ? url : null;
    } catch {
        return null;
    }
}

function findReadableContent(doc) {
    const selectors = [
        "article", "main", "[role='main']", ".chapter-content",
        ".entry-content", ".post-content", ".reading-content",
        ".content-body", "#content", "#chapter-content"
    ];
    let best = null;
    let bestLength = 0;
    for (const selector of selectors) {
        for (const candidate of doc.querySelectorAll(selector)) {
            const length = (candidate.innerText || candidate.textContent || "").trim().length;
            if (length > bestLength) {
                best = candidate;
                bestLength = length;
            }
        }
    }
    return best || doc.body;
}

function discoverChapters(doc, pageUrl) {
    const links = [];
    const seen = new Set();
    for (const anchor of doc.querySelectorAll("a[href]")) {
        const url = safeUrl(anchor.getAttribute("href"), pageUrl);
        const title = (anchor.innerText || anchor.textContent || "").replace(/\s+/g, " ").trim();
        if (!url || !title || url.origin !== pageUrl.origin || url.href.split("#")[0] === pageUrl.href.split("#")[0]) {
            continue;
        }
        if (url.pathname.match(/\.(jpg|jpeg|png|gif|webp|pdf|zip|epub)$/i)) continue;
        const normalized = url.href.split("#")[0];
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        links.push({url: normalized, title});
        if (links.length >= 300) break;
    }
    return links;
}

function renderChapterChoices(chapters) {
    chapterList.replaceChildren();
    chapters.forEach((chapter, index) => {
        const label = document.createElement("label");
        label.className = "chapter-choice";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = true;
        checkbox.value = String(index);
        checkbox.className = "chapter-checkbox";
        const title = document.createElement("span");
        title.textContent = chapter.title;
        const number = document.createElement("small");
        number.textContent = String(index + 1).padStart(2, "0");
        label.append(number, checkbox, title);
        chapterList.appendChild(label);
    });
    chapterCount.textContent = chapters.length + (chapters.length === 1 ? " chapter found" : " chapters found");
}

async function fetchStoryPage(url) {
    const pageUrl = new URL(url);
    const isAo3 = ["archiveofourown.org", "www.archiveofourown.org"].includes(pageUrl.hostname);
    if (isAo3) {
        const response = await fetch("/api/ao3?url=" + encodeURIComponent(pageUrl.href));
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "The AO3 fetch service could not retrieve this page.");
        return {url: result.url, html: result.html};
    }

    const response = await fetch(pageUrl.href, {credentials: "include", redirect: "follow"});
    if (!response.ok) throw new Error("The website returned HTTP " + response.status + ".");
    return {url: response.url || pageUrl.href, html: await response.text()};
}

async function fetchDocument(url) {
    const page = await fetchStoryPage(url);
    return new DOMParser().parseFromString(page.html, "text/html");
}

async function loadStory(url) {
    setStatus("Loading your story…");
    workspace.hidden = true;
    const page = await fetchStoryPage(url.href);
    const doc = new DOMParser().parseFromString(page.html, "text/html");
    const finalUrl = new URL(page.url || url.href);
    activeParser = Object.values(window.WebToEpubParsers || {})
        .find(parser => parser.supports(finalUrl)) || null;
    storyMetadata = activeParser?.getMetadata(doc) || null;
    let base = doc.querySelector("base");
    if (!base) {
        base = doc.createElement("base");
        doc.head.prepend(base);
    }
    base.href = finalUrl.href;

    sourceDocument = doc;
    sourceUrl = finalUrl;
    const candidates = activeParser
        ? await activeParser.getChapterUrls(doc, finalUrl.href, fetchDocument)
        : discoverChapters(doc, finalUrl);
    if (candidates.length === 0 && activeParser) {
        throw new Error("The supported parser could not find any chapters on this page.");
    }
    if (candidates.length === 0) {
        const title = doc.title || "Story";
        discoveredChapters = [{url: finalUrl.href, title}];
    } else {
        discoveredChapters = candidates;
    }

    bookTitle.value = storyMetadata?.title || doc.querySelector("meta[property='og:title']")?.content || doc.title || "WebToEpub book";
    bookAuthor.value = storyMetadata?.author || doc.querySelector("meta[name='author']")?.content || doc.querySelector("[rel='author']")?.textContent?.trim() || "Unknown";
    fileName.value = util.safeForFileName(bookTitle.value, 100);
    renderChapterChoices(discoveredChapters);
    workspace.hidden = false;
    setStatus("Found the page. Review the chapter list before creating your EPUB.");
    workspace.scrollIntoView({behavior: "smooth", block: "start"});
}

async function readLimitedImageBlob(response, limit) {
    if (!response.body || !response.body.getReader) {
        const blob = await response.blob();
        if (blob.size > limit) throw new Error("Image exceeds the remaining EPUB image-size limit.");
        return blob;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
        while (true) {
            const result = await reader.read();
            if (result.done) break;
            size += result.value.byteLength;
            if (size > limit) {
                await reader.cancel();
                throw new Error("Image exceeds the remaining EPUB image-size limit.");
            }
            chunks.push(result.value);
        }
    } finally {
        reader.releaseLock();
    }
    return new Blob(chunks, {type: response.headers.get("content-type") || ""});
}

async function prepareChapterImages(content, pageUrl) {
    for (const img of [...content.querySelectorAll("img[src]")]) {
        const rawSrc = img.getAttribute("src");
        let imageUrl;
        try {
            imageUrl = new URL(rawSrc, pageUrl);
        } catch {
            img.removeAttribute("src");
            skippedImageCount++;
            continue;
        }
        if (!["http:", "https:"].includes(imageUrl.protocol)) {
            img.removeAttribute("src");
            skippedImageCount++;
            continue;
        }

        let imageInfo = imageByUrl.get(imageUrl.href);
        if (!imageInfo) {
            try {
                const response = await fetch(imageUrl.href, {credentials: "include", redirect: "follow"});
                if (!response.ok) throw new Error("HTTP " + response.status);
                const declaredLength = Number(response.headers.get("content-length") || 0);
                if (declaredLength > MAX_IMAGE_BYTES) throw new Error("Image exceeds the 20 MB per-image limit.");
                const remainingBytes = Math.min(MAX_IMAGE_BYTES, MAX_TOTAL_IMAGE_BYTES - totalImageBytes);
                const blob = await readLimitedImageBlob(response, remainingBytes);
                const mimeType = (blob.type || response.headers.get("content-type") || "").split(";")[0].toLowerCase();
                if (!["image/jpeg", "image/png", "image/gif"].includes(mimeType)) throw new Error("Unsupported image format: " + (mimeType || "unknown"));
                if (blob.size === 0) throw new Error("The image response was empty.");
                if (blob.size > MAX_IMAGE_BYTES) throw new Error("Image exceeds the 20 MB per-image limit.");
                if (totalImageBytes + blob.size > MAX_TOTAL_IMAGE_BYTES) throw new Error("The EPUB image collection exceeds the 100 MB limit.");
                imageInfo = new ImageInfo(imageUrl.href, collectedImages.length, imageUrl.href, null);
                imageInfo.mediaType = mimeType;
                imageInfo.arraybuffer = await blob.arrayBuffer();
                totalImageBytes += blob.size;
                collectedImages.push(imageInfo);
                imageByUrl.set(imageUrl.href, imageInfo);
            } catch (error) {
                console.warn("Skipping EPUB image:", imageUrl.href, error);
                img.removeAttribute("src");
                if (!img.getAttribute("alt")) img.setAttribute("alt", "Image unavailable in EPUB");
                skippedImageCount++;
                continue;
            }
        }

        img.setAttribute("src", imageInfo.getZipHref().replace(/^OEBPS\/Images\//, "../Images/"));
        img.removeAttribute("srcset");
        img.removeAttribute("sizes");
        img.removeAttribute("loading");
    }
}

async function fetchChapter(chapter) {
    let page;
    try {
        page = await fetchStoryPage(chapter.url);
    } catch (error) {
        throw new Error("Could not fetch " + chapter.title + ": " + error.message);
    }
    const doc = new DOMParser().parseFromString(page.html, "text/html");
    const base = doc.createElement("base");
    base.href = page.url || chapter.url;
    doc.head.prepend(base);
    const parserContent = activeParser?.getContent(doc);
    if (activeParser && !parserContent) throw new Error("The AO3 chapter content area was not found. The page layout may have changed.");
    const content = parserContent ? activeParser.cleanContent(parserContent) : findReadableContent(doc);
    await prepareChapterImages(content, page.url || chapter.url);
    const wrapper = document.createElement("div");
    const hasEmbeddedTitle = activeParser?.hasEmbeddedChapterTitle(doc) || false;
    if (!hasEmbeddedTitle) {
        const heading = document.createElement("h1");
        heading.textContent = activeParser?.getChapterTitle(doc, chapter.title) || chapter.title || doc.title || "Chapter";
        wrapper.appendChild(heading);
    }
    for (const node of [...content.childNodes]) {
        const clone = util.sanitizeNode(node);
        if (clone) wrapper.appendChild(clone);
    }
    return wrapper;
}

function makeSupplier(items) {
    const imageCollector = {
        coverImageInfo: null,
        userPreferences: null,
        imagesToPackInEpub: () => collectedImages
    };
    return new EpubItemSupplier(null, items, imageCollector);
}

async function createEpub() {
    const selected = [...chapterList.querySelectorAll(".chapter-checkbox:checked")]
        .map(input => discoveredChapters[Number(input.value)]);
    if (selected.length === 0) {
        setConversionStatus("Select at least one chapter.", true);
        return;
    }

    convertButton.disabled = true;
    chapterProgress.max = selected.length;
    chapterProgress.value = 0;
    const items = [];
    collectedImages = [];
    imageByUrl = new Map();
    skippedImageCount = 0;
    totalImageBytes = 0;
    try {
        for (let index = 0; index < selected.length; index++) {
            const chapter = selected[index];
            setConversionStatus("Fetching chapter " + (index + 1) + " of " + selected.length + ": " + chapter.title);
            const content = await fetchChapter(chapter);
            items.push(new ChapterEpubItem({
                sourceUrl: chapter.url,
                title: chapter.title,
                newArc: null
            }, content, index));
            chapterProgress.value = index + 1;
        }

        const meta = new EpubMetaInfo();
        meta.uuid = sourceUrl.href;
        meta.title = bookTitle.value.trim() || "WebToEpub book";
        meta.author = bookAuthor.value.trim() || "Unknown";
        meta.language = storyMetadata?.language || sourceDocument.documentElement.lang || "en";
        if (storyMetadata?.description) meta.description = storyMetadata.description;
        if (storyMetadata?.subject) meta.subject = storyMetadata.subject;
        meta.fileName = util.safeForFileName(fileName.value || meta.title, 100);
        const packer = new EpubPacker(meta, EpubPacker.EPUB_VERSION_2);
        setConversionStatus("Building your EPUB with the existing WebToEpub packer…");
        if (skippedImageCount > 0) console.warn(skippedImageCount + " image(s) could not be included because browser access was blocked or the response was unsupported.");
        const blob = await packer.assemble(makeSupplier(items));
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = (meta.fileName.toLowerCase().endsWith(".epub") ? meta.fileName : meta.fileName + ".epub");
        link.className = "download-result";
        link.textContent = "Download " + link.download;
        link.addEventListener("click", () => setTimeout(() => URL.revokeObjectURL(downloadUrl), 60000), {once: true});
        const completionMessage = skippedImageCount > 0
            ? "Your EPUB is ready. " + skippedImageCount + " image(s) could not be included."
            : "Your EPUB is ready. ";
        conversionStatus.replaceChildren(document.createTextNode(completionMessage), link);
        conversionStatus.classList.remove("is-error");
    } catch (error) {
        setConversionStatus(error.message + " This site may block cross-origin browser requests (CORS), require a login, or use anti-bot protection. Try the browser extension for sites that need extension permissions.", true);
    } finally {
        convertButton.disabled = false;
    }
}

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const url = safeUrl(urlInput.value.trim());
    if (!url) {
        setStatus("Enter a valid HTTP or HTTPS story URL.", true);
        urlInput.focus();
        return;
    }
    try {
        await loadStory(url);
    } catch (error) {
        const isAo3 = url && ["archiveofourown.org", "www.archiveofourown.org"].includes(url.hostname);
        const hint = isAo3
            ? " Check that the WebToEpub Node.js server is running with: node server.js"
            : " This site may block browser access; the browser extension may still support it.";
        setStatus(error.message + hint, true);
    }
});

selectAllButton.addEventListener("click", () => {
    const boxes = [...chapterList.querySelectorAll(".chapter-checkbox")];
    const shouldSelect = boxes.some(box => !box.checked);
    boxes.forEach(box => box.checked = shouldSelect);
    selectAllButton.textContent = shouldSelect ? "Deselect all" : "Select all";
});

convertButton.addEventListener("click", createEpub);
