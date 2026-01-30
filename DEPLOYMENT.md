# PDF to Excel Converter - Deployment Guide

## Prerequisites
- Node.js 14+ installed
- npm or yarn package manager

## Installation Steps

### 1. Clone/Copy Project Files
Ensure all project files are in place:
```
Pdf-excel/
├── server.js
├── package.json
├── static/
│   ├── css/style.css
│   └── js/script.js
├── templates/
│   └── index.html
└── uploads/ (auto-created)
```

### 2. Install Dependencies
```bash
npm install
```

Required packages:
- express (web server)
- multer (file uploads)
- xlsx (Excel generation)
- pdf2json (PDF parsing)
- cors (CORS support)

### 3. Run Locally
```bash
node server.js
```
Access at: http://localhost:3000

## Deployment Options

### Option 1: Deploy to Vercel (Recommended for Static + Serverless)

1. Install Vercel CLI:
```bash
npm i -g vercel
```

2. Create `vercel.json`:
```json
{
  "version": 2,
  "builds": [
    {
      "src": "server.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "server.js"
    }
  ]
}
```

3. Deploy:
```bash
vercel
```

### Option 2: Deploy to Render.com

1. Create account at render.com
2. Create new Web Service
3. Connect your repository
4. Settings:
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Environment**: Node
   - **Port**: 3000

### Option 3: Deploy to Railway.app

1. Create account at railway.app
2. Create new project
3. Deploy from GitHub or local folder
4. Railway auto-detects Node.js
5. Set environment variables if needed

### Option 4: Traditional VPS/Cloud Server

**On Ubuntu/Debian:**

1. Install Node.js:
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

2. Install PM2 (process manager):
```bash
sudo npm install -g pm2
```

3. Upload files and install:
```bash
cd /var/www/pdf-excel
npm install
```

4. Start with PM2:
```bash
pm2 start server.js --name pdf-converter
pm2 save
pm2 startup
```

5. Setup Nginx reverse proxy:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Environment Variables (Optional)

Create `.env` file:
```
PORT=3000
MAX_FILE_SIZE=52428800
NODE_ENV=production
```

Update server.js to use:
```javascript
const port = process.env.PORT || 3000;
```

## Production Checklist

- [x] All dependencies installed
- [ ] Error handling in place
- [ ] File upload limits configured
- [ ] CORS configured if needed
- [ ] HTTPS/SSL certificate setup
- [ ] Environment variables configured
- [ ] PM2 or similar process manager (for VPS)
- [ ] Monitoring/logging enabled
- [ ] Domain name configured
- [ ] Firewall rules configured

## Troubleshooting

### Port Already in Use
```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Linux/Mac
lsof -ti:3000 | xargs kill -9
```

### File Upload Issues
- Check upload directory exists and has write permissions
- Verify file size limits in multer and server

### PDF Parsing Errors
- Ensure pdf2json is properly installed
- Check PDF file is not corrupted
- Verify PDF version compatibility

## Security Notes

1. **File Upload Security**:
   - Only accept PDF files
   - Limit file sizes (currently 50MB)
   - Sanitize filenames

2. **Production Settings**:
   - Use HTTPS in production
   - Set proper CORS origins
   - Implement rate limiting
   - Add authentication if needed

## Support

For issues or questions about deployment, check:
- Server logs: `pm2 logs` or console output
- Browser console for frontend errors
- Network tab for API request issues
