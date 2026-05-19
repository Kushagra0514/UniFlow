/**
 * ═══════════════════════════════════════════════════════════════════
 *  UniFlow Data Adapter  —  transformer.js
 * ═══════════════════════════════════════════════════════════════════
 *
 *  Single source of truth for transforming the raw DegreeWorks JSON
 *  into two purpose-built outputs:
 *
 *    1. D3 Tree   →  { name, status, children[] }
 *    2. AI Context →  compact plain-text summary (token-efficient)
 *
 *  Both visualizer.js and ai_entry.js import from here so the
 *  extraction logic is never duplicated.
 * ═══════════════════════════════════════════════════════════════════
 */

// ──────────────────────────────────────────────────────────────────
//  Shared helpers
// ──────────────────────────────────────────────────────────────────

/**
 * Extract applied courses from a rule's classesAppliedToRule field.
 * Returns an array of { course, grade, term } objects.
 */
function extractAppliedCourses(rule) {
    const classArray = rule?.classesAppliedToRule?.classArray;
    if (!Array.isArray(classArray)) return [];
    return classArray.map(c => ({
        course: `${c.discipline} ${c.number}`.trim(),
        grade: c.letterGrade || "",
        term: c.term || ""
    }));
}

/**
 * Extract valid course options from requirement / advice courseArrays.
 * Filters out wildcard patterns (@ @) and hideFromAdvice entries.
 * Returns deduplicated array of "DISC NUM" strings.
 */
function extractCourseOptions(rule) {
    const sources = [
        rule?.courseArray,
        rule?.requirement?.courseArray,
        rule?.advice?.courseArray
    ];

    const seen = new Set();
    const options = [];

    sources.forEach(arr => {
        if (!Array.isArray(arr)) return;
        arr.forEach(c => {
            if (c.hideFromAdvice === "Yes") return;
            if (c.discipline === "@" || c.number === "@") return;
            const key = `${c.discipline} ${c.number}`.trim();
            if (key && !seen.has(key)) {
                seen.add(key);
                options.push(key);
            }
        });
    });

    return options;
}

/**
 * Determine the status of a rule/block.
 * Returns "taken" | "progress" | "needed"
 */
function resolveStatus(item) {
    if (item.percentComplete === "100" || item.satisfied === "Yes") return "taken";
    if (item.inProgressIncomplete === "Yes" || (item.percentComplete && parseInt(item.percentComplete) > 0)) return "progress";
    return "needed";
}


// ──────────────────────────────────────────────────────────────────
//  1.  D3 TREE ADAPTER
//      Outputs strict { name, status, children[] } hierarchy
// ──────────────────────────────────────────────────────────────────

function processRuleForTree(rule) {
    let label = rule.label || rule.requirementValue || rule.summaryType;
    const applied = extractAppliedCourses(rule);
    const options = extractCourseOptions(rule);

    // Fallback label from first course if no label exists
    if (!label && options.length > 0) {
        label = options[0];
    }
    if (!label) return null;

    const status = resolveStatus(rule);
    const node = { name: label, status, children: [] };

    // Prune: hide children of completed nodes to reduce visual clutter
    if (status === "taken") {
        delete node.children;
        return node;
    }

    // Recurse into sub-rules
    if (Array.isArray(rule.ruleArray)) {
        rule.ruleArray.forEach(sub => {
            const child = processRuleForTree(sub);
            if (child) node.children.push(child);
        });
    }

    // Leaf course nodes (from applied)
    applied.forEach(c => {
        const courseStatus = c.grade === "IP" ? "progress" : "taken";
        node.children.push({ name: c.course, status: courseStatus });
    });

    // Show remaining option courses if the requirement is not fully completed yet
    if (status !== "taken" && options.length > 0) {
        const appliedSet = new Set(applied.map(a => a.course.toLowerCase().trim()));
        const remainingOptions = options.filter(opt => !appliedSet.has(opt.toLowerCase().trim()));
        
        remainingOptions.slice(0, 15).forEach(name => {
            node.children.push({ name, status: "needed" });
        });
    }

    if (node.children.length === 0) delete node.children;
    return node;
}

/**
 * transformForD3(rawJSON) → { name, status, children[] }
 * 
 * The single entry point for D3 visualization.
 * Strips all DW metadata (nodeId, labelTag, ruleId, etc.)
 * and outputs only what D3 needs to render a tree.
 */
function transformForD3(raw) {
    const overallProgress = parseInt(raw.auditHeader?.percentComplete || "0");
    const rootStatus = overallProgress >= 100 ? "taken" : "progress";

    const root = { name: "Degree Root", status: rootStatus, children: [] };
    const blocks = raw.blockArray || [];

    blocks.forEach(block => {
        // Skip the top-level DEGREE block if other blocks exist (it's just a container)
        if (block.requirementType === "DEGREE" && blocks.length > 1) return;

        const blockStatus = resolveStatus(block);
        const blockNode = {
            name: block.title || block.requirementValue || "Requirement Block",
            status: blockStatus,
            children: []
        };

        // Prune completed blocks
        if (blockStatus === "taken") {
            delete blockNode.children;
        } else if (Array.isArray(block.ruleArray)) {
            block.ruleArray.forEach(rule => {
                const child = processRuleForTree(rule);
                if (child) blockNode.children.push(child);
            });
        }

        if (blockNode.children || blockNode.status !== "taken") {
            root.children.push(blockNode);
        }
    });

    return root;
}


// ──────────────────────────────────────────────────────────────────
//  2.  AI CONTEXT ADAPTER
//      Outputs a flat, token-efficient summary for the system prompt
// ──────────────────────────────────────────────────────────────────

/**
 * Recursively flatten all rules (including nested ruleArrays)
 * into a single list of requirement objects for the AI.
 */
function flattenRulesForAI(rules, parentLabel) {
    const results = [];
    if (!Array.isArray(rules)) return results;

    rules.forEach(rule => {
        const label = rule.label || rule.requirementValue;
        if (!label) return;

        const applied = extractAppliedCourses(rule);
        const status = resolveStatus(rule);

        if (status === "taken") {
            // Include completed items so the AI knows what was taken
            if (applied.length > 0) {
                results.push({
                    requirement: label,
                    status: "COMPLETED",
                    courses: applied.map(c => `${c.course} (${c.grade})`)
                });
            } else {
                results.push({ requirement: label, status: "COMPLETED" });
            }
        } else {
            const options = extractCourseOptions(rule);
            const entry = {
                requirement: label,
                status: applied.length > 0 ? "IN_PROGRESS" : "NEEDED"
            };
            if (applied.length > 0) {
                entry.enrolled = applied.map(c => `${c.course} (${c.grade})`);
            }
            if (options.length > 0) {
                entry.options = options.slice(0, 8); // Cap at 8 to save tokens
            }
            results.push(entry);
        }

        // Recurse into sub-rules
        if (Array.isArray(rule.ruleArray)) {
            results.push(...flattenRulesForAI(rule.ruleArray, label));
        }
    });

    return results;
}

/**
 * transformForAI(rawJSON) → string
 * 
 * The single entry point for the AI system prompt.
 * Returns a compact JSON string with only the fields the AI needs:
 *   - student profile (major, gpa, credits, progress)
 *   - flattened list of all requirements with status + courses
 *
 * Typical reduction: ~500KB raw JSON → ~3-5KB AI context.
 */
function transformForAI(raw) {
    const header = raw.auditHeader || {};
    const blocks = raw.blockArray || [];

    const profile = {
        gpa: header.degreeworksGpa || "N/A",
        credits_applied: header.residentApplied 
            ? `${parseInt(header.residentApplied) + parseInt(header.transferApplied || 0)} total (${header.residentApplied} resident, ${header.transferApplied || 0} transfer)`
            : "N/A",
        progress: (header.percentComplete || "0") + "%"
    };

    const requirements = [];

    blocks.forEach(block => {
        const blockTitle = block.title || block.requirementValue || "Unknown Block";
        // Skip the top-level DEGREE wrapper
        if (block.requirementType === "DEGREE" && blocks.length > 1) return;

        const blockReqs = flattenRulesForAI(block.ruleArray, blockTitle);
        if (blockReqs.length > 0) {
            requirements.push({
                section: blockTitle,
                completion: (block.percentComplete || "0") + "%",
                items: blockReqs
            });
        }
    });

    return JSON.stringify({ student_profile: profile, requirements }, null, 1);
}

// Expose to global scope for both plain scripts and esbuild modules
if (typeof window !== "undefined") {
    window.transformForD3 = transformForD3;
    window.transformForAI = transformForAI;
}
