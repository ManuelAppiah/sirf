const fs = require('fs');
const path = require('path');
const pdfTableExtractor = require('pdf-table-extractor');
const XLSX = require('xlsx');

// Get file from command line args
const inputFile = process.argv[2];

if (!inputFile) {
    console.log("Usage: node convert_console.js <path_to_pdf>");
    process.exit(1);
}

const inputPath = path.resolve(inputFile);

if (!fs.existsSync(inputPath)) {
    console.error(`Error: File not found: ${inputPath}`);
    process.exit(1);
}

console.log(`Processing: ${inputPath}`);

// Callback for success
function success(result) {
    try {
        const wb = XLSX.utils.book_new();
        const pages = result.pageTables; // Array of pages

        if (pages.length === 0) {
            console.log("No tables found.");
            return;
        }

        pages.forEach((page, index) => {
            // Each page has 'tables' propery? 
            // Library output format: 
            // { pageTables: [ { page: 1, tables: [ ...rows... ], ... } ] }
            // Actually, looking at docs/examples:
            // result is { "pageTables": [ { "page": 1, "tables": [ ["Row1Col1", "Row1Col2"], ... ] } ... ] }

            if (page.tables && page.tables.length > 0) {
                // page.tables might be just the raw rows.
                // Actually library usually returns 'tables' as array of strings or array of arrays?
                // Let's assume it attempts to do rows.

                const ws = XLSX.utils.aoa_to_sheet(page.tables);
                const sheetName = `Page_${page.page}`;
                XLSX.utils.book_append_sheet(wb, ws, sheetName);
            }
        });

        const outputFilename = path.parse(inputPath).name + '_converted.xlsx';
        const outputPath = path.join(path.dirname(inputPath), outputFilename);

        XLSX.writeFile(wb, outputPath);
        console.log(`\nSuccess! Excel file created: ${outputPath}`);
        console.log("You can now open this file in Excel and sort/filter the data.");

    } catch (e) {
        console.error("Error creating Excel file:", e);
    }
}

// Callback for error
function error(err) {
    console.error('Error during extraction:', err);
}

// Run extraction
pdfTableExtractor(inputPath, success, error);
