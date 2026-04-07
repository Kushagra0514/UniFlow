const originalFetch = window.fetch;
let bufferedData = null;
let contentReady = false;

// Listen for content script ready signal
window.addEventListener("message", (event) => {
    if (event.data?.type === "CONTENT_SCRIPT_READY") {
        contentReady = true;
        if (bufferedData) {
            window.postMessage({ type: "DEGREE_DATA_INTERCEPTED", payload: bufferedData }, "*");
            bufferedData = null;
        }
    }
});

window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const url = args[0] instanceof Request ? args[0].url : args[0];

    if (typeof url === 'string' && url.includes('audit?studentId=')) {
        const clone = response.clone();
        clone.json().then(data => {
            if (contentReady) {
                window.postMessage({ type: "DEGREE_DATA_INTERCEPTED", payload: data }, "*");
            } else {
                bufferedData = data; // Hold it until content.js is ready
            }
        }).catch(err => console.error("Failed to parse intercepted JSON", err));
    }

    return response;
};