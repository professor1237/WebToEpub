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

async function fetchDocument(url) {
    const response = await fetch(url, {credentials: "include", redirect: "follow"});
    if (!response.ok) throw new Error("The website returned HTTP " + response.status + ".");
    const html = await response.text();
    return new DOMParser().parseFromString(html, "text/html");
}

async function loadStory(url) {
    setStatus("Checking whether this website allows browser access…");
    workspace.hidden = true;
    const response = await fetch(url.href, {credentials: "include", redirect: "follow"});
    if (!response.ok) throw new Error("The website returned HTTP " + response.status + ".");
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const finalUrl = new URL(response.url || url.href);
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

async function fetchChapter(chapter) {
    const response = await fetch(chapter.url, {credentials: "include", redirect: "follow"});
    if (!response.ok) throw new Error("Could not fetch " + chapter.title + " (HTTP " + response.status + ").");
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const base = doc.createElement("base");
    base.href = response.url || chapter.url;
    doc.head.prepend(base);
    const parserContent = activeParser?.getContent(doc);
    const content = parserContent ? activeParser.cleanContent(parserContent) : findReadableContent(doc);
    const wrapper = document.createElement("div");
    const heading = document.createElement("h1");
    heading.textContent = activeParser?.getChapterTitle(doc, chapter.title) || chapter.title || doc.title || "Chapter";
    wrapper.appendChild(heading);
    for (const node of [...content.childNodes]) {
        const clone = util.sanitizeNode(node);
        if (clone) wrapper.appendChild(clone);
    }
    return wrapper;
}

function makeSupplier(items) {
    const imageCollector = {
        coverImageInfo: null,
        imagesToPackInEpub: () => []
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
        const blob = await packer.assemble(makeSupplier(items));
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = (meta.fileName.toLowerCase().endsWith(".epub") ? meta.fileName : meta.fileName + ".epub");
        link.className = "download-result";
        link.textContent = "Download " + link.download;
        link.addEventListener("click", () => setTimeout(() => URL.revokeObjectURL(downloadUrl), 60000), {once: true});
        conversionStatus.replaceChildren(document.createTextNode("Your EPUB is ready. "), link);
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
        setStatus(error.message + " If the browser reports a CORS error, this site cannot be converted directly by the website. The extension may still support it.", true);
    }
});

selectAllButton.addEventListener("click", () => {
    const boxes = [...chapterList.querySelectorAll(".chapter-checkbox")];
    const shouldSelect = boxes.some(box => !box.checked);
    boxes.forEach(box => box.checked = shouldSelect);
    selectAllButton.textContent = shouldSelect ? "Deselect all" : "Select all";
});

convertButton.addEventListener("click", createEpub);
