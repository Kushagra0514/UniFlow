document.addEventListener("DOMContentLoaded", () => {
    const themeToggle = document.getElementById('theme-toggle');
    if (!themeToggle) return;
    
    const root = document.documentElement;

    // Check for saved theme preference or system preference
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        root.classList.add('light');
        themeToggle.innerText = 'Dark Mode';
    }

    themeToggle.addEventListener('click', () => {
        root.classList.toggle('light');
        if (root.classList.contains('light')) {
            themeToggle.innerText = 'Dark Mode';
            localStorage.setItem('theme', 'light');
        } else {
            themeToggle.innerText = 'Light Mode';
            localStorage.setItem('theme', 'dark');
        }
    });
});

const showError = (msg) => {
    const overlay = document.getElementById("error-overlay");
    if (overlay) {
        overlay.innerText = "ERROR: " + msg;
        overlay.style.display = "flex";
    }
    console.error("Visualizer Error:", msg);
};

function initialize() {
    console.log("Initializing Visualizer...");
    if (typeof chrome === "undefined" || !chrome.storage) {
        showError("Chrome Extension API not detected.");
        return;
    }

    chrome.storage.local.get("userDegreeData", (result) => {
        if (!result || !result.userDegreeData) {
            document.getElementById("major-display").innerText = "WAITING FOR DATA...";
            setTimeout(initialize, 2000);
            return;
        }
        
        const data = result.userDegreeData;
        
        try {
            const blocks = data.blockArray || [];
            const major = blocks.find(b => b.requirementType === "MAJOR")?.title || 
                          blocks.find(b => b.requirementType === "PROGRAM")?.title || 
                          "Degree Audit";
            
            document.getElementById("major-display").innerText = major;
            document.getElementById("gpa-display").innerText = data.auditHeader?.degreeworksGpa || "N/A";
            document.getElementById("progress-display").innerText = data.auditHeader?.percentComplete || "0";

            // Use the shared Data Adapter (transformer.js)
            const treeData = transformForD3(data);
            
            if (!treeData || !treeData.children || treeData.children.length === 0) {
                showError("No renderable blocks found.");
            } else {
                renderTree(treeData);
                const overlay = document.getElementById("error-overlay");
                if (overlay) overlay.style.display = "none";
                // Send raw data to AI — it will use transformForAI() internally
                window.postMessage({ type: "AUDIT_DATA_READY", payload: data }, "*");
            }
        } catch (e) {
            showError("Processing failed: " + e.message);
        }
    });
}

function renderTree(data) {
    if (typeof d3 === "undefined") return;

    const container = document.getElementById("tree-container");
    const width = container.clientWidth || 1000;
    const height = container.clientHeight || 800;

    d3.select("#tree-container svg").remove();

    const svg = d3.select("#tree-container").append("svg")
        .attr("width", "100%")
        .attr("height", "100%")
        .call(d3.zoom().scaleExtent([0.01, 5]).on("zoom", (e) => g.attr("transform", e.transform)));

    const g = svg.append("g");
    
    const tree = d3.tree().nodeSize([50, 280]); 
    const hierarchy = d3.hierarchy(data);
    tree(hierarchy);

    g.selectAll(".link")
        .data(hierarchy.links())
        .enter().append("path")
        .attr("class", "link")
        .attr("d", d3.linkHorizontal().x(d => d.y).y(d => d.x));

    const node = g.selectAll(".node")
        .data(hierarchy.descendants())
        .enter().append("g")
        .attr("class", "node")
        .attr("transform", d => `translate(${d.y},${d.x})`);

    node.append("circle")
        .attr("r", 4)
        .attr("class", d => `status-${d.data.status || 'needed'}`);

    node.append("text")
        .attr("dy", "0.31em")
        .attr("x", d => d.children ? -10 : 10)
        .attr("text-anchor", d => d.children ? "end" : "start")
        .text(d => d.data.name);

    const zoomIdentity = d3.zoomIdentity.translate(150, height / 2).scale(0.5);
    svg.call(d3.zoom().transform, zoomIdentity);
}

document.addEventListener("DOMContentLoaded", initialize);

