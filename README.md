# PDF to Excel Converter

A web-based tool to convert PDF documents into structured Excel spreadsheets with intelligent table extraction.

## Features

- 📄 **Smart PDF Parsing**: Extracts tables and metadata from PDF documents
- 📊 **Excel Generation**: Creates formatted Excel files matching the original PDF structure
- 🎯 **SIRF Form Support**: Specialized extraction for Stock Issue Request Forms
- 🎨 **Modern UI**: Clean, responsive interface with drag-and-drop upload
- 🔄 **Multi-Column Detection**: Intelligently identifies and maps all table columns

## Supported Data

**Metadata Fields:**
- Site Name, Site ID
- Project Code, Project Name
- Request Date, Need by Date, Req. No.
- Requesting Department, REG, Project Manager

**Table Columns:**
- S.No, MTN Item code
- Item description, Type of Item
- Qty requested, UOM
- PO Number, OEM Part Number
- OEM Serial Number, Qty Issued

## Quick Start

### Installation

```bash
# Install dependencies
npm install

# Start server
npm start
```

Access at: http://localhost:3000

### Usage

1. Open the web interface
2. Drag & drop or browse for your PDF file
3. Click "Convert to Excel"
4. Download the generated Excel file

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed deployment instructions for:
- Vercel
- Render
- Railway
- VPS/Cloud Servers

## File Structure

```
Pdf-excel/
├── server.js           # Express server & extraction logic
├── package.json        # Dependencies
├── static/
│   ├── css/style.css   # UI styling
│   └── js/script.js    # Frontend logic
├── templates/
│   └── index.html      # Main page
├── uploads/            # Temporary file storage
└── DEPLOYMENT.md       # Deployment guide
```

## Technology Stack

- **Backend**: Node.js, Express
- **PDF Parsing**: pdf2json
- **Excel Generation**: xlsx (SheetJS)
- **File Upload**: Multer
- **Frontend**: Vanilla HTML/CSS/JavaScript

## License

ISC

## Support

For issues or questions, please check the server logs and browser console for error details.
