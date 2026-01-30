const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const PDFParser = require("pdf2json");

const app = express();
const port = 3000;

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Configure file uploads
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed!'), false);
        }
    }
});

// Serve static files
app.use('/static', express.static(path.join(__dirname, 'static')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'templates', 'index.html'));
});

// CORE EXTRACTION LOGIC
function extractSmartData(pdfData) {
    // Helper to find value next to label
    function findValue(texts, labelPatterns, options = {}) {
        const patterns = Array.isArray(labelPatterns) ? labelPatterns : [labelPatterns];

        const label = texts.find(t => {
            const str = decodeURIComponent(t.R[0].T);
            return patterns.some(p => p.test(str));
        });

        if (!label) return "";

        // Look for text to the right (same line)
        let candidate = texts.find(t =>
            Math.abs(t.y - label.y) < 1.0 &&
            t.x > label.x + 1.0
        );

        // Look strictly below
        if (!candidate && !options.rightOnly) {
            candidate = texts.find(t =>
                t.y > label.y && t.y < label.y + 4 &&
                Math.abs(t.x - label.x) < 10
            );
        }

        return candidate ? decodeURIComponent(candidate.R[0].T) : "";
    }

    // Combine all texts from all pages for metadata search
    let allTexts = [];
    pdfData.Pages.forEach(p => {
        allTexts = allTexts.concat(p.Texts);
    });

    // Extract all metadata fields (SIRF form specific)
    const metaData = {
        "Request Date": findValue(allTexts, /Request\s*Date/i, { rightOnly: true }),
        "Need by Date": findValue(allTexts, /Need\s*by\s*Date/i, { rightOnly: true }),
        "Req. No": findValue(allTexts, /Req\.\s*No/i, { rightOnly: true }),
        "Project Code": findValue(allTexts, /Project\s*Code/i, { rightOnly: true }),
        "Project Name": findValue(allTexts, /Project\s*Name/i, { rightOnly: true }),
        "Site ID": findValue(allTexts, /Site\s*ID/i, { rightOnly: true }),
        "Site Name": findValue(allTexts, /Site\s*Name/i, { rightOnly: true }),
        "Requesting Dept": findValue(allTexts, /Requesting\s*Dept/i, { rightOnly: true }),
        "REG": findValue(allTexts, /REG:/i, { rightOnly: true }),
        "Project Mgr": findValue(allTexts, /Project\s*Mgr/i, { rightOnly: true })
    };

    // DYNAMIC TABLE EXTRACTION - Find ALL columns automatically
    let tableHeaders = [];
    let tableHeaderY = -1;
    let headerRow = null;

    // Strategy: Look for the first row that looks like headers
    // Common header indicators: contains words like "code", "description", "qty", "item", "number", etc.
    // Or has multiple items on same Y-level with similar formatting

    const firstPageTexts = pdfData.Pages.length > 0 ? pdfData.Pages[0].Texts : [];

    // Group texts by Y position to find rows
    const rowMap = new Map();
    firstPageTexts.forEach(t => {
        const yKey = Math.round(t.y * 2) / 2; // Round to 0.5 precision
        if (!rowMap.has(yKey)) rowMap.set(yKey, []);
        rowMap.get(yKey).push(t);
    });

    // Find the header row - look for a row with multiple items that looks like headers
    for (const [y, texts] of rowMap.entries()) {
        if (texts.length >= 3) { // At least 3 columns
            // Sort by X position
            texts.sort((a, b) => a.x - b.x);

            // Check if this looks like a header row
            const rowText = texts.map(t => decodeURIComponent(t.R[0].T)).join(' ').toLowerCase();
            const headerKeywords = ['code', 'description', 'qty', 'quantity', 'item', 'number', 'uom', 'type', 'requested', 'name', 's.no', 'sno'];

            const matchCount = headerKeywords.filter(kw => rowText.includes(kw)).length;

            if (matchCount >= 2) { // Found likely header row
                tableHeaderY = y;
                headerRow = texts;
                // Extract header names and positions
                tableHeaders = texts.map(t => ({
                    name: decodeURIComponent(t.R[0].T),
                    x: t.x
                }));
                break;
            }
        }
    }

    const tableRows = [];

    // If we found headers, extract data using column positions
    if (tableHeaders.length > 0) {

        pdfData.Pages.forEach(page => {
            // Determine start Y for data rows
            let startY = 0;
            const hasHeader = page.Texts.some(t => Math.abs(t.y - tableHeaderY) < 2);
            if (hasHeader) startY = tableHeaderY + 2.0;

            const rowTexts = page.Texts.filter(t => t.y > startY);

            // Cluster by Y (rows)
            rowTexts.sort((a, b) => a.y - b.y);

            let currentRowY = -1;
            let rowItems = [];

            const processRow = (items) => {
                if (items.length === 0) return;

                const rowData = {};
                // Initialize all columns
                tableHeaders.forEach(h => rowData[h.name] = "");

                items.forEach(item => {
                    const x = item.x;
                    const val = decodeURIComponent(item.R[0].T);

                    // Find which column this belongs to based on X position
                    let bestHeaderIdx = -1;
                    let minDist = 1000;

                    for (let i = 0; i < tableHeaders.length; i++) {
                        const header = tableHeaders[i];
                        const nextHeader = tableHeaders[i + 1];

                        // Check if X is within this column's range
                        const colStart = header.x - 2.0;
                        const colEnd = nextHeader ? (nextHeader.x - 2.0) : 1000;

                        if (x >= colStart && x < colEnd) {
                            bestHeaderIdx = i;
                            break;
                        }

                        // Also track closest header as fallback
                        const dist = Math.abs(x - header.x);
                        if (dist < minDist) {
                            minDist = dist;
                            bestHeaderIdx = i;
                        }
                    }

                    if (bestHeaderIdx !== -1) {
                        const headerName = tableHeaders[bestHeaderIdx].name;
                        if (rowData[headerName]) rowData[headerName] += " " + val;
                        else rowData[headerName] = val;
                    }
                });

                // Validate: Must have at least one non-empty column
                const hasData = Object.values(rowData).some(v => v.trim() !== "");
                if (hasData) {
                    tableRows.push(rowData);
                }
            };

            rowTexts.forEach(t => {
                if (currentRowY === -1 || Math.abs(t.y - currentRowY) > 0.6) {
                    processRow(rowItems);
                    currentRowY = t.y;
                    rowItems = [t];
                } else {
                    rowItems.push(t);
                }
            });
            processRow(rowItems);
        });
    }

    return {
        meta: metaData,
        rows: tableRows,
        headers: tableHeaders.map(h => h.name) // Return detected headers
    };
}

app.post('/convert', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const inputPath = req.file.path;
    const outputFilename = req.file.originalname.replace(/\.pdf$/i, '') + '_' + Date.now() + '.xlsx';
    const outputPath = path.join(uploadDir, outputFilename);

    console.log(`Processing Excel: ${inputPath}`);

    const pdfParser = new PDFParser();

    pdfParser.on("pdfParser_dataError", errData => {
        console.error("PDF Parser Error:", errData.parserError);
        res.status(500).json({ error: 'Failed to parse PDF.' });
    });

    pdfParser.on("pdfParser_dataReady", pdfData => {
        try {
            const data = extractSmartData(pdfData);
            const wb = XLSX.utils.book_new();

            // Create worksheet with SIRF form layout
            const ws = XLSX.utils.aoa_to_sheet([]);

            // Row 1: Form Title
            XLSX.utils.sheet_add_aoa(ws, [
                ["Stock Issue Request Form (SIRF)"]
            ], { origin: "A1" });

            // Row 2: Request Date | Need by Date | Req. No
            XLSX.utils.sheet_add_aoa(ws, [
                ["Request Date", data.meta["Request Date"], "", "Need by Date", data.meta["Need by Date"], "", "Req. No.", data.meta["Req. No"]]
            ], { origin: "A2" });

            // Row 3: Project Code | Project Name
            XLSX.utils.sheet_add_aoa(ws, [
                ["Project Code", data.meta["Project Code"], "", "Project Name:", data.meta["Project Name"]]
            ], { origin: "A3" });

            // Row 4: Site ID | Site Name
            XLSX.utils.sheet_add_aoa(ws, [
                ["Site ID", data.meta["Site ID"], "", "Site Name:", data.meta["Site Name"]]
            ], { origin: "A4" });

            // Row 5: Requesting Dept | REG | Project Mgr
            XLSX.utils.sheet_add_aoa(ws, [
                ["Requesting Dept.", data.meta["Requesting Dept"], "", "REG:", data.meta["REG"], "", "Project Mgr.", data.meta["Project Mgr"]]
            ], { origin: "A5" });

            // Row 6: Empty spacer

            // Row 7: Department headers (if needed - skip for now as we don't know the column count)

            // Row 8: DYNAMIC Table Headers (use detected headers)
            if (data.headers && data.headers.length > 0) {
                XLSX.utils.sheet_add_aoa(ws, [data.headers], { origin: "A8" });

                // Row 9+: Table Data (dynamically map to headers)
                const tableRows = data.rows.map(rowData => {
                    return data.headers.map(header => rowData[header] || "");
                });
                XLSX.utils.sheet_add_aoa(ws, tableRows, { origin: "A9" });

                // Column Widths - Dynamic based on content
                const colWidths = data.headers.map((header, idx) => {
                    // Calculate max width for this column
                    let maxWidth = header.length;

                    data.rows.forEach(row => {
                        const cellValue = row[header] || "";
                        if (cellValue.length > maxWidth) {
                            maxWidth = cellValue.length;
                        }
                    });

                    // Limit width: min 8, max 50 characters
                    return { wch: Math.min(Math.max(maxWidth + 2, 8), 50) };
                });

                ws['!cols'] = colWidths;
            } else {
                // Fallback if no headers detected
                XLSX.utils.sheet_add_aoa(ws, [
                    ["No table detected - please check PDF structure"]
                ], { origin: "A8" });
            }

            XLSX.utils.book_append_sheet(wb, ws, "SIRF");

            // ---------------------------------------------------------
            // STRATEGY B: Visual Layout (Projection Profile Grid) - Kept for completeness
            // ---------------------------------------------------------
            // This algorithm projects all text onto the X-axis to find global column gaps.

            pdfData.Pages.forEach((page, pageIndex) => {
                // 1. Map raw texts with geometry
                const rawTexts = page.Texts.map(t => ({
                    x: t.x,
                    y: t.y,
                    w: t.w || (t.R[0].T.length * 0.4), // Estimate width if missing
                    text: decodeURIComponent(t.R[0].T)
                }));

                if (rawTexts.length === 0) return;

                // 2. Determine Column Boundaries using X-Projection
                const maxX = Math.ceil(Math.max(...rawTexts.map(t => t.x + t.w)) + 2);
                const resolution = 10;
                const occupancy = new Int8Array(maxX * resolution).fill(0);

                rawTexts.forEach(t => {
                    const start = Math.floor(t.x * resolution);
                    const end = Math.floor((t.x + t.w) * resolution);
                    for (let i = start; i < end; i++) {
                        occupancy[i] = 1;
                    }
                });

                const columns = [];
                let inBlock = false;
                const GAP_THRESHOLD = 2.0 * resolution;
                let gapCounter = 0;
                let colStart = -1;

                for (let i = 0; i < occupancy.length; i++) {
                    if (occupancy[i] === 1) {
                        if (!inBlock) {
                            colStart = i;
                            inBlock = true;
                        }
                        gapCounter = 0;
                    } else {
                        gapCounter++;
                        if (inBlock && gapCounter > GAP_THRESHOLD) {
                            columns.push({
                                start: colStart / resolution,
                                end: (i - gapCounter) / resolution
                            });
                            inBlock = false;
                        }
                    }
                }
                if (inBlock) {
                    columns.push({
                        start: colStart / resolution,
                        end: occupancy.length / resolution
                    });
                }

                // 3. Map Rows
                rawTexts.sort((a, b) => a.y - b.y);
                const rows = [];
                let currentRowY = -1;
                let currentRowItems = [];

                rawTexts.forEach(item => {
                    if (currentRowY === -1 || Math.abs(item.y - currentRowY) > 0.6) {
                        if (currentRowItems.length > 0) rows.push({ y: currentRowY, items: currentRowItems });
                        currentRowY = item.y;
                        currentRowItems = [item];
                    } else currentRowItems.push(item);
                });
                if (currentRowItems.length > 0) rows.push({ y: currentRowY, items: currentRowItems });

                // 4. Create Grid
                let finalDataB = [];

                if (columns.length === 0) {
                    finalDataB = rows.map(r => [r.items.map(i => i.text).join(" ")]);
                } else {
                    finalDataB = rows.map(row => {
                        const rowArr = new Array(columns.length).fill("");
                        row.items.forEach(item => {
                            let bestCol = -1;
                            let maxOverlap = 0;
                            const itemStart = item.x;
                            const itemEnd = item.x + item.w;

                            columns.forEach((col, idx) => {
                                const overlapStart = Math.max(itemStart, col.start);
                                const overlapEnd = Math.min(itemEnd, col.end);
                                if (overlapEnd > overlapStart) {
                                    const overlap = overlapEnd - overlapStart;
                                    if (overlap > maxOverlap) {
                                        maxOverlap = overlap;
                                        bestCol = idx;
                                    }
                                }
                            });

                            if (bestCol === -1) {
                                let minDiff = 1000;
                                columns.forEach((col, idx) => {
                                    const diff = Math.abs(col.start - itemStart);
                                    if (diff < minDiff) {
                                        minDiff = diff;
                                        bestCol = idx;
                                    }
                                });
                            }

                            if (bestCol !== -1) {
                                rowArr[bestCol] = rowArr[bestCol] ? rowArr[bestCol] + " " + item.text : item.text;
                            }
                        });
                        return rowArr;
                    });
                }

                if (finalDataB.length > 0) {
                    const wsB = XLSX.utils.aoa_to_sheet(finalDataB);
                    const colWidths = (finalDataB[0] || []).map((_, i) => ({ wch: 10 }));
                    finalDataB.slice(0, 50).forEach(row => {
                        row.forEach((cell, i) => {
                            if (cell && cell.length > colWidths[i].wch) {
                                colWidths[i].wch = Math.min(cell.length + 2, 50);
                            }
                        });
                    });
                    wsB['!cols'] = colWidths;

                    const range = XLSX.utils.decode_range(wsB['!ref']);
                    const borderStyle = {
                        top: { style: 'thin', color: { rgb: 'D3D3D3' } },
                        bottom: { style: 'thin', color: { rgb: 'D3D3D3' } },
                        left: { style: 'thin', color: { rgb: 'D3D3D3' } },
                        right: { style: 'thin', color: { rgb: 'D3D3D3' } }
                    };

                    for (let R = range.s.r; R <= range.e.r; R++) {
                        for (let C = range.s.c; C <= range.e.c; C++) {
                            const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
                            if (!wsB[cellAddress]) continue;
                            if (!wsB[cellAddress].s) wsB[cellAddress].s = {};
                            wsB[cellAddress].s.border = borderStyle;

                            if (R === 0) {
                                wsB[cellAddress].s.font = { bold: true, color: { rgb: 'FFFFFF' } };
                                wsB[cellAddress].s.fill = { fgColor: { rgb: '4472C4' }, patternType: 'solid' };
                                wsB[cellAddress].s.alignment = { vertical: 'center', horizontal: 'center' };
                            } else {
                                wsB[cellAddress].s.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
                            }
                        }
                    }
                    XLSX.utils.book_append_sheet(wb, wsB, `Original Page ${pageIndex + 1}`);
                }
            });

            XLSX.writeFile(wb, outputPath);
            res.json({ success: true, download_url: `/download/${outputFilename}` });

        } catch (e) {
            console.error("Conversion Logic Error:", e);
            res.status(500).json({ error: 'Error converting data to Excel.' });
        }
    });

    // Start parsing
    pdfParser.loadPDF(inputPath);
});

app.post('/reformat', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const inputPath = req.file.path;
    const outputFilename = req.file.originalname.replace(/\.pdf$/i, '') + '_reformatted_' + Date.now() + '.pdf';
    const outputPath = path.join(uploadDir, outputFilename);

    console.log(`Processing PDF Reformat: ${inputPath}`);

    const pdfParser = new PDFParser();
    pdfParser.on("pdfParser_dataError", errData => {
        console.error("PDF Parser Error:", errData.parserError);
        res.status(500).json({ error: 'Failed to parse PDF.' });
    });
    pdfParser.on("pdfParser_dataReady", async (pdfData) => {
        try {
            const data = extractSmartData(pdfData);
            await createProfessionalPdf(data, outputPath);
            res.json({ success: true, download_url: `/download/${outputFilename}` });
        } catch (e) {
            console.error("PDF Reformat Error:", e);
            res.status(500).json({ error: 'Error generating PDF.' });
        }
    });
    pdfParser.loadPDF(inputPath);
});

app.get('/download/:filename', (req, res) => {
    const filename = req.params.filename;
    const file = path.join(uploadDir, filename);
    if (fs.existsSync(file)) {
        res.download(file);
    } else {
        res.status(404).send('File not found');
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
