const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const PDFParser = require("pdf2json");
const PDFDocument = require('pdfkit');

const app = express();
const port = 3000;

// Configure file uploads
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
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

app.use(express.static('templates'));
app.use('/static', express.static('static'));

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

    // Extract all metadata fields
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

    const tableRows = [];

    // Define ALL table columns based on the SIRF form
    const definedColumns = [
        { id: 'sno', pattern: /S\.?\s*No/i, x: -1 },
        { id: 'mtncode', pattern: /MTN\s*(Item\s*)?code/i, x: -1 },
        { id: 'desc', pattern: /Item\s*description/i, x: -1 },
        { id: 'type', pattern: /Type\s*of\s*Item/i, x: -1 },
        { id: 'qty', pattern: /(Qty\s*)?requested/i, x: -1 },
        { id: 'uom', pattern: /UOM/i, x: -1 },
        { id: 'po', pattern: /PO\s*Number/i, x: -1 },
        { id: 'oem', pattern: /OEM\s*Part\s*Number/i, x: -1 },
        { id: 'oemserial', pattern: /OEM\s*Serial/i, x: -1, optional: true },
        { id: 'issued', pattern: /Qty\s*Issued/i, x: -1, optional: true }
    ];

    let tableHeaderY = -1;

    // Find Header Positions (scan first page primarily)
    const firstPageTexts = pdfData.Pages.length > 0 ? pdfData.Pages[0].Texts : [];

    firstPageTexts.forEach(t => {
        const str = decodeURIComponent(t.R[0].T);
        definedColumns.forEach(col => {
            if (col.pattern.test(str)) {
                if (col.x === -1) {
                    col.x = t.x;
                    // Use "MTN code" or "Item description" as anchor for table start Y
                    if (col.id === 'mtncode' || col.id === 'desc') {
                        tableHeaderY = t.y;
                    }
                }
            }
        });
    });

    // Sort columns by X position to create intervals
    const activeColumns = definedColumns.filter(c => c.x !== -1).sort((a, b) => a.x - b.x);

    // If we found at least 3 columns, we can form a table
    if (activeColumns.length >= 3) {

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

                const rowObj = {};
                // Initialize all columns
                definedColumns.forEach(c => rowObj[c.id] = "");

                items.forEach(item => {
                    const x = item.x;
                    const val = decodeURIComponent(item.R[0].T);

                    // Map to column intervals
                    let bestColId = null;

                    for (let i = 0; i < activeColumns.length; i++) {
                        const col = activeColumns[i];
                        const nextCol = activeColumns[i + 1];

                        const start = col.x - 2.0;
                        const end = nextCol ? (nextCol.x - 2.0) : 1000;

                        if (x >= start && x < end) {
                            bestColId = col.id;
                            break;
                        }
                    }

                    if (bestColId) {
                        if (rowObj[bestColId]) rowObj[bestColId] += " " + val;
                        else rowObj[bestColId] = val;
                    }
                });

                // Validate: Must have MTN code or description
                if (rowObj.mtncode || rowObj.desc) {
                    tableRows.push(rowObj);
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

    return { meta: metaData, rows: tableRows };
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
            // Row 7: Department headers (optional, can skip)
            XLSX.utils.sheet_add_aoa(ws, [
                ["", "", "", "", "User Department", "", "", "", "Warehouse Department", ""]
            ], { origin: "A7" });

            // Row 8: Table Headers
            XLSX.utils.sheet_add_aoa(ws, [
                ["S.No", "MTN Item code", "Item description", "Type of Item", "Qty requested", "UOM", "PO Number", "OEM Part Number", "OEM Serial Number", "Qty Issued"]
            ], { origin: "A8" });

            // Row 9+: Table Data
            const tableRows = data.rows.map(r => [
                r.sno,
                r.mtncode,
                r.desc,
                r.type,
                r.qty,
                r.uom,
                r.po,
                r.oem,
                r.oemserial || "",
                r.issued || ""
            ]);
            XLSX.utils.sheet_add_aoa(ws, tableRows, { origin: "A9" });

            // Column Widths
            ws['!cols'] = [
                { wch: 6 },   // A: S.No
                { wch: 12 },  // B: MTN Code
                { wch: 45 },  // C: Description
                { wch: 12 },  // D: Type
                { wch: 10 },  // E: Qty
                { wch: 8 },   // F: UOM
                { wch: 10 },  // G: PO Number
                { wch: 15 },  // H: OEM Part
                { wch: 15 },  // I: OEM Serial
                { wch: 10 }   // J: Qty Issued
            ];

            XLSX.utils.book_append_sheet(wb, ws, "SIRF");

            XLSX.writeFile(wb, outputPath);
            res.json({ success: true, download_url: `/download/${outputFilename}` });

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
                // We create a histogram/occupancy array for the width of the page
                // PDF width is usually around 0-40 (for pdf2json units, roughly 1 unit ~ 10-20px?)
                // Let's assume max width is around 100 units for safety.
                const maxX = Math.ceil(Math.max(...rawTexts.map(t => t.x + t.w)) + 2);
                const resolution = 10; // steps per unit. Higher = finer precision
                const occupancy = new Int8Array(maxX * resolution).fill(0);

                // Fill occupancy
                rawTexts.forEach(t => {
                    const start = Math.floor(t.x * resolution);
                    const end = Math.floor((t.x + t.w) * resolution);
                    for (let i = start; i < end; i++) {
                        occupancy[i] = 1;
                    }
                });

                // Find gaps (sequences of 0s)
                // We ignore small gaps (less than e.g. 1.0 unit) to avoid splitting words
                const columns = []; // Store { start, end } of columns
                let inBlock = false;
                let blockStart = 0;

                // Threshold for a gap to be considered a column separator 
                // (e.g., 2 units of whitespace)
                const GAP_THRESHOLD = 2.0 * resolution;

                let gapCounter = 0;
                let colStart = -1;

                for (let i = 0; i < occupancy.length; i++) {
                    if (occupancy[i] === 1) {
                        if (!inBlock) {
                            // potential start of a column block
                            // if we had a large gap, the previous block ended effectively
                            colStart = i;
                            inBlock = true;
                        }
                        gapCounter = 0;
                    } else {
                        // Whitespace
                        gapCounter++;
                        if (inBlock && gapCounter > GAP_THRESHOLD) {
                            // We found a splitter. The column ended before this gap.
                            // The end of the column was roughly (i - gapCounter)
                            columns.push({
                                start: colStart / resolution,
                                end: (i - gapCounter) / resolution
                            });
                            inBlock = false;
                        }
                    }
                }
                // Close last block
                if (inBlock) {
                    columns.push({
                        start: colStart / resolution,
                        end: occupancy.length / resolution
                    });
                }

                // 3. Map Rows
                // Sort by Y
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
                /* 
                   If no columns found (e.g. single block of text), fallback to standard lines.
                   Otherwise, map items to the detected column buckets.
                */

                let finalDataB = [];

                if (columns.length === 0) {
                    // Fallback: Just lines
                    finalDataB = rows.map(r => [r.items.map(i => i.text).join(" ")]);
                } else {
                    finalDataB = rows.map(row => {
                        const rowArr = new Array(columns.length).fill("");

                        row.items.forEach(item => {
                            // Find best fitting column
                            // An item belongs to a column if it overlaps significantly
                            let bestCol = -1;
                            let maxOverlap = 0;

                            const itemStart = item.x;
                            const itemEnd = item.x + item.w;

                            columns.forEach((col, idx) => {
                                // Overlap calculation
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

                            // Fallback: closest start
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

                    // Calculate column widths
                    const colWidths = (finalDataB[0] || []).map((_, i) => ({ wch: 10 }));
                    finalDataB.slice(0, 50).forEach(row => {
                        row.forEach((cell, i) => {
                            if (cell && cell.length > colWidths[i].wch) {
                                colWidths[i].wch = Math.min(cell.length + 2, 50);
                            }
                        });
                    });
                    wsB['!cols'] = colWidths;

                    // Apply table formatting with borders
                    const range = XLSX.utils.decode_range(wsB['!ref']);

                    // Define border style
                    const borderStyle = {
                        top: { style: 'thin', color: { rgb: 'D3D3D3' } },
                        bottom: { style: 'thin', color: { rgb: 'D3D3D3' } },
                        left: { style: 'thin', color: { rgb: 'D3D3D3' } },
                        right: { style: 'thin', color: { rgb: 'D3D3D3' } }
                    };

                    // Apply borders and styling to all cells
                    for (let R = range.s.r; R <= range.e.r; R++) {
                        for (let C = range.s.c; C <= range.e.c; C++) {
                            const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
                            if (!wsB[cellAddress]) continue;

                            // Initialize cell style
                            if (!wsB[cellAddress].s) wsB[cellAddress].s = {};

                            // Apply borders to all cells
                            wsB[cellAddress].s.border = borderStyle;

                            // Style first row as header
                            if (R === 0) {
                                wsB[cellAddress].s.font = { bold: true, color: { rgb: 'FFFFFF' } };
                                wsB[cellAddress].s.fill = {
                                    fgColor: { rgb: '4472C4' },
                                    patternType: 'solid'
                                };
                                wsB[cellAddress].s.alignment = {
                                    vertical: 'center',
                                    horizontal: 'center'
                                };
                            } else {
                                // Data rows - center align
                                wsB[cellAddress].s.alignment = {
                                    vertical: 'top',
                                    horizontal: 'left',
                                    wrapText: true
                                };
                            }
                        }
                    }

                    XLSX.utils.book_append_sheet(wb, wsB, `Original Page ${pageIndex + 1}`);
                }
            });

            XLSX.writeFile(wb, outputPath);

            res.json({
                success: true,
                download_url: `/download/${outputFilename}`
            });

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
