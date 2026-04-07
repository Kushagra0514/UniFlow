chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "OPEN_VISUALIZER") {
        chrome.tabs.create({ url: chrome.runtime.getURL("visualizer.html") });
    }
});
