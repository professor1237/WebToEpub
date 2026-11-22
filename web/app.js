"use strict";

const form = document.getElementById("url-form");
const urlInput = document.getElementById("story-url");
const status = document.getElementById("form-status");

form.addEventListener("submit", (event) => {
    event.preventDefault();
    status.textContent = "";

    let storyUrl;
    try {
        storyUrl = new URL(urlInput.value.trim());
    } catch {
        status.textContent = "Enter a complete story URL, including https://.";
        urlInput.focus();
        return;
    }

    if (!["http:", "https:"].includes(storyUrl.protocol)) {
        status.textContent = "Only HTTP and HTTPS story links are supported.";
        urlInput.focus();
        return;
    }

    status.textContent = "Link looks valid. The website's shared parser and EPUB engine are the next integration step; the browser extension remains available in the meantime.";
});
