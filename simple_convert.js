const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const XLSX = require('xlsx');

const inputFile = process.argv[2];

if (!inputFile) {
    console.log("Usage: node simple_convert.js <path_to_pdf>");
    process.exit(1);
}

const inputPath = path.resolve(inputFile);
if (!fs.existsSync(inputPath)) {
    console.error("File not found:", inputPath);
    process.exit(1);
}

console.log(`Reading PDF: ${inputPath}...`);

// Read file buffer
const dataBuffer = fs.readFileSync(inputPath);

pdfParse(dataBuffer).then(function (data) {
    // data.text contains all text
    const text = data.text;

    // Process text into rows
    // tailored to capture table-like structures
    const lines = text.split(/\r?\n/);
    const rows = [];

    lines.forEach(line => {
        // Trim line
        const trimmed = line.trim();
        if (trimmed) {
            // Split by 2 or more spaces to define columns
            // This is a common heuristic for text-based PDF tables
            const columns = trimmed.split(/\s{2,}/);
            rows.push(columns);
        }
    });

    if (rows.length === 0) {
        console.log("No text content found in PDF.");
        return;
    }

    // Create Excel
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Auto-width columns (optional, basic attempt)
    const colWidths = [];
    rows.forEach(row => {
        row.forEach((cell, i) => {
            const len = (cell ? cell.toString().length : 0);
            if (!colWidths[i] || len > colWidths[i]) {
                colWidths[i] = len;
            }
        });
    });
    ws['!cols'] = colWidths.map(w => ({ wch: w + 2 }));

    XLSX.utils.book_append_sheet(wb, ws, "Extracted Content");

    const outputName = path.parse(inputPath).name + '_extracted.xlsx';
    const outputPath = path.join(path.dirname(inputPath), outputName);

    XLSX.writeFile(wb, outputPath);

    console.log("\n---------------------------------------------------");
    console.log("Conversion Complete!");
    console.log(`Excel file saved to: ${outputPath}`);
    console.log("---------------------------------------------------");

}).catch(err => {
    console.error("Error parsing PDF:", err);
});
