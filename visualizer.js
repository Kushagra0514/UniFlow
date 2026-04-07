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

            const treeData = transformData(data);
            
            if (!treeData || !treeData.children || treeData.children.length === 0) {
                showError("No renderable blocks found.");
            } else {
                renderTree(treeData);
                const overlay = document.getElementById("error-overlay");
                if (overlay) overlay.style.display = "none";
            }
        } catch (e) {
            showError("Processing failed: " + e.message);
        }
    });
}

/**
 * Extracts and deduplicates courses from a rule.
 */
function getCoursesFromRule(rule) {
    let rawCourses = [];
    if (rule.courseArray && Array.isArray(rule.courseArray)) rawCourses = rawCourses.concat(rule.courseArray);
    if (rule.requirement && rule.requirement.courseArray && Array.isArray(rule.requirement.courseArray)) rawCourses = rawCourses.concat(rule.requirement.courseArray);
    if (rule.advice && rule.advice.courseArray && Array.isArray(rule.advice.courseArray)) rawCourses = rawCourses.concat(rule.advice.courseArray);
    
    const seen = new Set();
    const uniqueCourses = [];
    
    rawCourses.forEach(course => {
        // Create a unique key for deduplication
        const id = `${course.discipline}|${course.number}|${course.courseTitle}`.toLowerCase().trim();
        if (!seen.has(id)) {
            seen.add(id);
            uniqueCourses.push(course);
        }
    });
    
    return uniqueCourses;
}

/**
 * Recursively transforms a rule and its children into tree nodes.
 */
function processRule(rule) {
    let label = rule.label || rule.requirementValue || rule.summaryType;
    const courses = getCoursesFromRule(rule);
    
    if (!label && courses.length > 0) {
        const first = courses[0];
        label = first.courseTitle || `${first.discipline || ""} ${first.number || ""}`.trim();
    }
    
    if (!label) return null;

    // Determine status for Parent Nodes (Rules/Sections)
    let status = "needed";
    if (rule.percentComplete === "100" || rule.satisfied === "Yes") {
        status = "taken";
    } else if (rule.inProgressIncomplete === "Yes" || (rule.percentComplete && parseInt(rule.percentComplete) > 0)) {
        status = "progress";
    }

    const node = { name: label, status: status, children: [] };

    // HIDE CHILDREN IF NODE IS DONE (Pruning)
    if (status === "taken") {
        delete node.children;
        return node;
    }

    // 1. Process nested sub-rules
    if (rule.ruleArray && Array.isArray(rule.ruleArray)) {
        rule.ruleArray.forEach(sub => {
            const child = processRule(sub);
            if (child) node.children.push(child);
        });
    }

    // 2. Process individual courses
    if (courses.length > 0) {
        courses.forEach(course => {
            const disc = course.discipline || "";
            const num = course.number || "";
            const title = course.courseTitle || "";
            let courseName = `${disc} ${num}`.trim();
            if (title) courseName += `: ${title}`;

            let courseStatus = "needed";
            if (course.letterGrade) {
                courseStatus = (course.letterGrade === "IP") ? "progress" : "taken";
            }
            
            if (courseName) {
                node.children.push({ 
                    name: courseName, 
                    status: courseStatus 
                });
            }
        });
    }

    if (node.children.length === 0) delete node.children;
    return node;
}

function transformData(raw) {
    const overallProgress = parseInt(raw.auditHeader?.percentComplete || "0");
    const rootStatus = overallProgress >= 100 ? "taken" : "progress";
    
    const root = { name: "Degree Root", status: rootStatus, children: [] };
    const blocks = raw.blockArray || [];

    blocks.forEach(block => {
        if (block.requirementType === "DEGREE" && blocks.length > 1) return;

        const blockStatus = (block.percentComplete === "100" || block.satisfied === "Yes") ? "taken" : "progress";
        const blockNode = { 
            name: block.title || block.requirementValue || "Requirement Block", 
            status: blockStatus,
            children: [] 
        };
        
        // HIDE CHILDREN IF BLOCK IS DONE
        if (blockStatus === "taken") {
            delete blockNode.children;
        } else if (block.ruleArray && Array.isArray(block.ruleArray)) {
            block.ruleArray.forEach(rule => {
                const child = processRule(rule);
                if (child) blockNode.children.push(child);
            });
        }
        
        if (blockNode.children || blockNode.status !== "taken") {
            root.children.push(blockNode);
        }
    });
    return root;
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
    
    const tree = d3.tree().nodeSize([25, 350]); 
    const hierarchy = d3.hierarchy(data);
    tree(hierarchy);

    g.selectAll(".link")
        .data(hierarchy.links())
        .enter().append("path")
        .attr("class", "link")
        .attr("d", d3.linkHorizontal().x(d => d.y).y(d => d.x))
        .attr("fill", "none")
        .attr("stroke", "#333")
        .attr("stroke-width", 1);

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
        .text(d => d.data.name)
        .style("fill", "#bbb")
        .style("font-size", "10px")
        .style("text-shadow", "1px 1px 2px #000");

    const zoomIdentity = d3.zoomIdentity.translate(150, height / 2).scale(0.5);
    svg.call(d3.zoom().transform, zoomIdentity);
}

document.addEventListener("DOMContentLoaded", initialize);
