# Crowd Management System

A real-time web application for monitoring crowd occupancy, footfall, demographics, and visitor entries in public venues like malls, offices, and campuses.

## 🌐 Live Demo

**🔗 [View Live Site on Netlify](https://crowd-management-ui-angular.netlify.app)**

Experience the full application with real-time updates, interactive charts, and all features live on Netlify.

**Test Credentials:**
- **Email/Username:** `test@test.com`
- **Password:** `1234567890`

## 🚀 Features

- **Live Dashboard** - Real-time occupancy tracking with live updates via Socket.IO
- **Summary Metrics** - Today's footfall, average dwell time, and live occupancy with percentage comparisons
- **Interactive Charts** - Occupancy timeline and demographics visualization
- **Visitor Records** - Paginated entry/exit records with detailed visitor information
- **Multi-site Support** - Switch between different venues/locations
- **Historical Data** - View data for any past date using date picker
- **Bilingual Support** - English and Arabic language toggle

## 🛠️ Tech Stack

- **Angular 17** (Standalone Components)
- **Angular Material** (UI Components)
- **ngx-charts** (Data Visualization)
- **Socket.IO Client** (Real-time Updates)
- **RxJS** (Reactive Programming)
- **TypeScript**

## 📋 Prerequisites

- **Node.js** (v18 or higher) - [Download here](https://nodejs.org/)
- **npm** (comes with Node.js) or **yarn**

## ⚡ Installation & Setup

### Step 1: Clone the Repository

```bash
git clone https://github.com/Syed-afsha/Crowd-management-ui-angular.git
cd Crowd-management-ui-angular
```

### Step 2: Install Dependencies

```bash
npm install
```

This will install all required packages including Angular, Angular Material, ngx-charts, Socket.IO, etc.

### Step 3: Configure API Endpoint (Optional)

The project uses a proxy configuration for development (`proxy.conf.json`), so the API endpoint is automatically handled. However, if you need to configure it manually:

Update `src/environments/environment.ts` if needed:

```typescript
export const environment = {
  production: false,
  apiUrl: 'https://hiring-dev.internal.kloudspot.com'  // API base URL
};
```

**Note:** 
- For development, the proxy configuration handles API calls automatically
- The production environment (`environment.prod.ts`) is already configured
- If you're using a different API, update both files accordingly

### Step 4: Start Development Server

```bash
npm start
```

The application will automatically open at: **http://localhost:4200**

If it doesn't open automatically, navigate to that URL in your browser.

### Step 5: Build for Production

```bash
npm run build
```

Output will be in `dist/crowd-management-ui/` directory, ready for deployment.

## ✅ Verify Installation

After running `npm start`, you should see:

```
✔ Browser application bundle generation complete.
✔ Compiled successfully.
** Angular Live Development Server is listening on localhost:4200 **
```

Open http://localhost:4200 in your browser to see the login page.

## 🔧 Troubleshooting

### Port Already in Use?
```bash
npm start -- --port 4201  # Use a different port
# Then open http://localhost:4201
```

### Installation Errors?
```bash
# Clear npm cache and reinstall
npm cache clean --force
# Windows:
rmdir /s node_modules
del package-lock.json
npm install

# Mac/Linux:
rm -rf node_modules package-lock.json
npm install
```

### Build Errors?
Make sure you have:
- Node.js v18 or higher (`node --version`)
- Latest npm (`npm install -g npm@latest`)

### API Connection Issues?
- Check if the API server is running
- Verify the API URL in `src/environments/environment.ts`
- Check browser console for CORS errors
- The proxy configuration should handle CORS in development

### Socket.IO Connection Issues?
- Ensure WebSocket is supported on your network
- Check if the backend Socket.IO server is running
- Verify the socket URL matches the API base URL

## 🏗️ Build for Production

```bash
npm run build

# Output: dist/crowd-management-ui/
```

## 📁 Project Structure

```
src/app/
├── features/          # Feature modules
│   ├── auth/         # Login page
│   ├── dashboard/    # Main dashboard with charts
│   └── entries/      # Visitor records table
├── layout/           # App shell (sidebar, header)
├── core/             # Core services & guards
│   ├── services/     # API, Auth, Socket services
│   ├── guards/       # Route guards
│   └── interceptors/ # HTTP interceptors
└── shared/           # Shared components
```

## 🔌 API Configuration

### Development Environment

Edit `src/environments/environment.ts`:

```typescript
export const environment = {
  production: false,
  apiUrl: 'https://hiring-dev.internal.kloudspot.com'  // Base API URL (without /api)
};
```

**Note:** The Socket.IO connection automatically uses the same base URL as the API.

### Production Environment

The production environment (`environment.prod.ts`) is already configured for:
- API URL: `https://hiring-dev.internal.kloudspot.com`

When you build for production, it will automatically use the production environment configuration.

### Proxy Configuration (Development)

If you're running into CORS issues in development, you can use the proxy configuration in `proxy.conf.json`. The Angular CLI will automatically use this when running `ng serve`.

## ✨ Key Features Explained

### Real-time Updates
- Automatic live occupancy updates via WebSocket
- Footfall count refreshes automatically on entry/exit events
- No page refresh needed

### Performance Optimizations
- OnPush change detection strategy
- API response caching
- Batch API calls for faster loading
- Optimized chart rendering

### Security
- JWT-based authentication
- Protected routes with auth guards
- Secure token storage

## 📝 Assignment Requirements

✅ Login screen with password visibility toggle  
✅ Dashboard with live occupancy, footfall, and dwell time  
✅ Percentage comparison with yesterday  
✅ Occupancy timeline chart  
✅ Demographics charts (pie + timeline)  
✅ Entry/exit records table with pagination  
✅ Real-time updates via Socket.IO  
✅ Multi-site selection  
✅ Date selection for historical data  

## 🎯 Performance

- Dashboard loads within 2-5 seconds
- Optimized API calls with caching
- Efficient change detection
- Responsive charts that adapt to screen size

## 📦 Deployment

### Build for Production

```bash
npm run build
```

This creates optimized production files in `dist/crowd-management-ui/` directory.

### Deploy to Static Hosting

Upload the contents of `dist/crowd-management-ui/` to any static hosting service:

- **Netlify** - Drag and drop the folder or connect via Git
  - **Live Site**: [[https://crowd-management-ui-angular.netlify.app](https://crowd-management-ui-angular-syed.netlify.app/login)]
- **Vercel** - Deploy via CLI: `vercel --prod`
- **GitHub Pages** - Push the dist folder to gh-pages branch
- **Firebase Hosting** - Use Firebase CLI
- **Any web server** - Upload files to your server's public directory

### Important Notes

- Make sure your production API URL is correctly set in `environment.prod.ts`
- The application requires CORS to be enabled on the backend API
- Socket.IO connection requires WebSocket support on the hosting platform

## 📄 License

This project is part of a hiring assessment for Kloudspot.

## 👤 Author

Built as a frontend assignment demonstrating:
- Angular best practices
- Real-time data handling
- Performance optimization
- Clean code architecture
