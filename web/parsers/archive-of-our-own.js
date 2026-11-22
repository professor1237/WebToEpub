"use strict";

/*
 * Browser adapter for the existing AO3 parser rules.
 * This deliberately uses the website's fetch adapter rather than the
 * extension-only Parser, HttpClient, preferences, and UI classes.
 */
window.WebToEpubParsers = window.WebToEpubParsers || {};

class ArchiveOfOurOwnWebParser {
    static supports(url) {
        return ["archiveofourown.org", "www.archiveofourown.org", "archiveofourown.com", "archiveofourown.net", "archiveofourown.gay", "ao3.org", "archive.transformativeworks.org", "insecure.archiveofourown.org"].includes(url.hostname);
    }

    static withReaderFlags(value) {
        const url = new URL(value);
        url.searchParams.set("view_adult", "true");
        url.searchParams.set("view_full_work", "false");
        return url.href;
    }

    static linkToChapter(link, baseUrl) {
        return {
            url: this.withReaderFlags(new URL(link.getAttribute("href"), baseUrl).href),
            title: (link.textContent || "").trim() || "Untitled chapter"
        };
    }

    static async fetchChapterUrls(url, fetchDocument) {
        const doc = await fetchDocument(url);
        return [...doc.querySelectorAll("ol.chapter a[href]")]
            .map(link => this.linkToChapter(link, url));
    }

    static async getChapterUrls(doc, pageUrl, fetchDocument) {
        if (new URL(pageUrl).pathname.includes("/series/")) {
            const chapters = [];
            const works = [...doc.querySelectorAll("ul.series.work > li")];
            for (const work of works) {
                const chaptersLink = work.querySelector("dd.chapters a[href]");
                if (!chaptersLink) {
                    const single = work.querySelector("h4.heading a[href]");
                    if (single) chapters.push(this.linkToChapter(single, pageUrl));
                    continue;
                }
                const chapterUrl = new URL(chaptersLink.getAttribute("href"), pageUrl);
                const marker = chapterUrl.pathname.indexOf("/chapters/");
                if (marker < 0) continue;
                chapterUrl.pathname = chapterUrl.pathname.slice(0, marker) + "/navigate";
                chapters.push(...await this.fetchChapterUrls(chapterUrl.href, fetchDocument));
            }
            return chapters;
        }

        const chapterElement = doc.querySelector("li.chapter");
        if (!chapterElement) {
            return [{
                url: this.withReaderFlags(pageUrl),
                title: doc.querySelector("h2.heading")?.textContent.trim() || doc.title || "Story"
            }];
        }

        let navigationUrl = doc.querySelector("ul#chapter_index a[href]")?.href;
        if (!navigationUrl) {
            const pathParts = new URL(pageUrl).pathname.split("/");
            const workIndex = pathParts.indexOf("works");
            const workId = pathParts[workIndex + 1];
            if (workIndex < 0 || !/^\d+$/.test(workId || "")) {
                return [{url: this.withReaderFlags(pageUrl), title: doc.title || "Story"}];
            }
            navigationUrl = new URL("/works/" + workId + "/navigate", pageUrl).href;
        }
        return this.fetchChapterUrls(navigationUrl, fetchDocument);
    }

    static getContent(doc) {
        return doc.querySelector("div#chapters");
    }

    static getMetadata(doc) {
        return {
            title: doc.querySelector("h2.heading")?.textContent.trim() ||
                doc.querySelector("h2.title")?.textContent.trim() || doc.title || "WebToEpub book",
            author: doc.querySelector("a[rel='author']")?.textContent.trim() || "Unknown",
            language: doc.querySelector("meta[name='language']")?.getAttribute("content") ||
                doc.documentElement.lang || "en",
            description: doc.querySelector("div.summary blockquote")?.textContent.trim() || "",
            subject: [...doc.querySelectorAll(".meta .tags a")]
                .map(tag => tag.textContent.trim()).filter(Boolean).join(", ")
        };
    }

    static getChapterTitle(doc, fallback) {
        return doc.querySelector("h3.title")?.textContent.trim() ||
            doc.querySelector("h2.heading")?.textContent.trim() ||
            fallback || doc.title || "Chapter";
    }

    static cleanContent(content) {
        const clone = content.cloneNode(true);
        clone.querySelectorAll("h3.landmark.heading, .chapter .navigation, .chapter .actions").forEach(node => node.remove());
        return clone;
    }
}

window.WebToEpubParsers.archiveOfOurOwn = ArchiveOfOurOwnWebParser;
