window.addEventListener("message", (event) => {
    // Security check
    if (event.source !== window || !event.data || event.data.type !== "DEGREE_DATA_INTERCEPTED") {
        return;
    }

    const degreeData = event.data.payload;
    console.log("✅ JSON Payload Intercepted:", degreeData);

    // 1. Save to local storage
    chrome.storage.local.set({ "userDegreeData": degreeData }, () => {
        if (chrome.runtime.lastError) {
            console.error("❌ Storage write failed:", chrome.runtime.lastError);
        } else {
            console.log("💾 Data saved to local storage.");
        }
    });

    // 2. Extract stats safely
    const blocks = degreeData.blockArray || [];
    const majorBlock = blocks.find(b => b.requirementType === "MAJOR") || 
                       blocks.find(b => b.requirementType === "PROGRAM") ||
                       blocks[0];
    
    const majorTitle = majorBlock?.title || "Degree Audit Found";
    const header = degreeData.auditHeader || {};
    const gpa = header.degreeworksGpa || "N/A";
    const completion = header.percentComplete || "0";

    // 3. Remove existing overlay
    const oldBox = document.getElementById("dw-ai-overlay");
    if (oldBox) oldBox.remove();

    // 4. Build floating UI
    const displayBox = document.createElement("div");
    displayBox.id = "dw-ai-overlay";
    Object.assign(displayBox.style, {
        position: "fixed",
        bottom: "20px",
        right: "20px",
        padding: "20px",
        backgroundColor: "#1e1e1e",
        color: "#00ff00",
        zIndex: "999999",
        borderRadius: "12px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        border: "1px solid #333",
        minWidth: "250px"
    });

    displayBox.innerHTML = `
        <h3 style="margin:0 0 10px 0; color: #fff; font-size: 16px;">AI Visualizer Ready</h3>
        <div style="font-size: 13px; color: #ccc; margin-bottom: 15px;">
            <p style="margin: 5px 0;"><strong>Major:</strong> ${majorTitle}</p>
            <p style="margin: 5px 0;"><strong>GPA:</strong> ${gpa}</p>
            <p style="margin: 5px 0;"><strong>Progress:</strong> ${completion}%</p>
        </div>
        <button id="launch-visualizer" style="
            width: 100%;
            padding: 10px;
            background-color: #00ff00;
            color: #000;
            border: none;
            border-radius: 6px;
            font-weight: bold;
            cursor: pointer;
        ">VIEW PATH TO GRADUATION</button>
    `;

    document.body.appendChild(displayBox);

    // 5. Use Background Script to open tab (MV3 standard)
    document.getElementById("launch-visualizer").onclick = () => {
        chrome.runtime.sendMessage({ type: "OPEN_VISUALIZER" });
    };
});

// Signal ready
window.postMessage({ type: "CONTENT_SCRIPT_READY" }, "*");
