const PDFDocument = require('pdfkit');
const fs = require('fs');

const doc = new PDFDocument();

doc.pipe(fs.createWriteStream('test.pdf'));

doc.fontSize(25).text('Test PDF with Table', 100, 100);

doc.moveDown();

const tableTop = 200;
const itemX = 50;
const costX = 350;

doc.fontSize(14);
doc.text('Item', itemX, tableTop);
doc.text('Cost', costX, tableTop);

doc.moveTo(itemX, tableTop + 20)
    .lineTo(550, tableTop + 20)
    .stroke();

const items = [
    { name: 'Widget A', cost: '10.00' },
    { name: 'Widget B', cost: '20.00' },
    { name: 'Gadget C', cost: '30.00' },
    { name: 'Thingy D', cost: '40.00' }
];

let y = tableTop + 35;

items.forEach(item => {
    doc.text(item.name, itemX, y);
    doc.text(item.cost, costX, y);
    y += 30;
});

doc.end();
console.log('PDF created');
