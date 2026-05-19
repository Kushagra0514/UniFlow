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
    
    const rawTitle = majorBlock?.title || "Degree Audit Found";
    const majorTitle = rawTitle.replace(/^(Major|Degree):\s*/i, "");
    const header = degreeData.auditHeader || {};
    const gpa = header.degreeworksGpa || "N/A";
    const completion = header.percentComplete || "0";

    // 3. Remove existing overlay
    const oldBox = document.getElementById("dw-ai-overlay");
    if (oldBox) oldBox.remove();

    // 4. Build floating UI (Dynamic-Flux Theme)
    const displayBox = document.createElement("div");
    displayBox.id = "dw-ai-overlay";
    Object.assign(displayBox.style, {
        position: "fixed",
        bottom: "24px",
        right: "24px",
        padding: "24px",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        zIndex: "999999",
        borderRadius: "16px",
        fontFamily: "'Outfit', system-ui, sans-serif",
        boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
        border: "1px solid",
        minWidth: "280px",
        transition: "all 0.3s ease"
    });

    displayBox.innerHTML = `
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600&family=Syne:wght@600&display=swap');
            
            #dw-ai-overlay {
                --color-white-smoke: #F6F5F3;
                --color-parchment: #ECE9E4;
                --color-dust-grey: #D2CEC6;
                --color-silver: #AFA99D;
                --color-charcoal: #514D48;
                --color-graphite: #363430;
                --color-carbon-black: #211F1D;
                --color-pitch-black: #11100E;
                
                --bg-glass: rgba(17, 16, 14, 0.75);
                --text-primary: var(--color-white-smoke);
                --text-secondary: var(--color-silver);
                --text-highlight: var(--color-white-smoke);
                --border-color: rgba(255, 255, 255, 0.08);
                --btn-bg: rgba(255, 255, 255, 0.9);
                --btn-text: var(--color-pitch-black);
                --btn-hover: #ffffff;
                
                background-color: var(--bg-glass);
                color: var(--text-primary);
                border-color: var(--border-color);
            }

            #dw-ai-overlay.light-theme {
                --bg-glass: rgba(246, 245, 243, 0.85);
                --text-primary: var(--color-pitch-black);
                --text-secondary: var(--color-charcoal);
                --text-highlight: var(--color-pitch-black);
                --border-color: rgba(17, 16, 14, 0.15);
                --btn-bg: var(--color-pitch-black);
                --btn-text: var(--color-white-smoke);
                --btn-hover: var(--color-carbon-black);
            }

            #dw-ai-overlay:hover {
                border-color: var(--border-color);
                box-shadow: 0 10px 40px rgba(0,0,0,0.6), 0 0 20px rgba(255,255,255,0.05);
            }
            #launch-visualizer {
                width: 100%;
                padding: 12px;
                background: var(--btn-bg);
                color: var(--btn-text);
                border: none;
                border-radius: 8px;
                font-family: 'Syne', sans-serif;
                font-weight: 600;
                letter-spacing: 1px;
                cursor: pointer;
                transition: all 0.2s ease;
                margin-top: 8px;
            }
            #launch-visualizer:hover {
                background: var(--btn-hover);
                transform: translateY(-1px);
            }
            .theme-toggle-btn {
                position: absolute;
                top: 20px;
                right: 20px;
                background: none;
                border: none;
                color: var(--text-secondary);
                cursor: pointer;
                font-size: 16px;
                padding: 4px;
                line-height: 1;
                transition: color 0.2s;
            }
            .theme-toggle-btn:hover {
                color: var(--text-primary);
            }
        </style>
        <button id="theme-toggle-btn" class="theme-toggle-btn" title="Toggle Theme">☀️</button>
        <h3 style="margin:0 0 12px 0; color: var(--text-primary); font-family: 'Syne', sans-serif; font-size: 18px; letter-spacing: 0.5px;">UniFlow Ready</h3>
        <div style="font-size: 14px; color: var(--text-secondary); margin-bottom: 16px; line-height: 1.5;">
            <p style="margin: 4px 0;"><span style="color: var(--text-highlight); font-weight: 600;">MAJOR:</span> &nbsp;${majorTitle}</p>
            <p style="margin: 4px 0;"><span style="color: var(--text-highlight); font-weight: 600;">GPA:</span> &nbsp;${gpa}</p>
            <p style="margin: 4px 0;"><span style="color: var(--text-highlight); font-weight: 600;">PROGRESS:</span> &nbsp;<span style="color: #10B981;">${completion}%</span></p>
        </div>
        <button id="launch-visualizer">VIEW DEGREE PATH</button>
    `;

    document.body.appendChild(displayBox);

    // Toggle theme listener
    const themeBtn = displayBox.querySelector("#theme-toggle-btn");
    themeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        displayBox.classList.toggle("light-theme");
        themeBtn.innerText = displayBox.classList.contains("light-theme") ? "🌙" : "☀️";
    });

    // 4.5. Inject hidden iframe to Preload the AI Model into IndexedDB Cache
    const preloadFrame = document.createElement("iframe");
    preloadFrame.src = chrome.runtime.getURL("visualizer.html?preload=true");
    Object.assign(preloadFrame.style, { width: "0", height: "0", border: "none", position: "absolute", visibility: "hidden" });
    document.body.appendChild(preloadFrame);

    // 5. Use Background Script to open tab
    const launchBtn = displayBox.querySelector("#launch-visualizer");
    launchBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        chrome.runtime.sendMessage({ type: "OPEN_VISUALIZER" });
    });
});

// Signal ready
window.postMessage({ type: "CONTENT_SCRIPT_READY" }, "*");
