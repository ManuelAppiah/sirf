# PDF to Excel Converter

A comprehensive web application to extract tables from PDF files and convert them into Excel spreadsheets, preserving formatting and structure.

## Features

-   **Premium UI**: Glassmorphism design with smooth animations.
-   **Smart Extraction**: Uses `Tabula` (via `tabula-js`) for accurate table extraction.
-   **Instant Download**: Converts and provides a download link immediately.
-   **Secure**: Files are processed locally.

## Prerequisites

-   **Node.js**: v14 or higher.
-   **Java**: Required for the extraction engine (Tabula).

## Installation

1.  Install dependencies:
    ```bash
    npm install
    ```

## Usage

1.  Start the server:
    ```bash
    node server.js
    ```

2.  Open your browser and navigate to:
    ```
    http://localhost:3000
    ```

3.  Drag and drop your PDF file to convert it.

## Troubleshooting

-   **Extraction Failed**: Ensure Java is installed and in your system PATH (`java -version`).
-   **No Tables Found**: If the PDF contains image-based tables (scanned), this tool might not extract them. It works best with native text-based PDFs.
